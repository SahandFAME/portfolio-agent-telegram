import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {calculateGoldWeek,mergeGoldWeeks,goldHistorySvg,applyHistoryPriceFallbacks} from '../lib/gold-history.js';
import {app} from './helpers/app-fixture.mjs';

const checked='2026-10-25T09:00:00Z',asof='2026-10-21T20:29:59Z';
const q=p=>({price_rial:p,source:'Synthetic verified quote',quoted_at:asof});
const options={assets:['gold','stock','dust','fund'],groups:{gold:'gold',stock:'stock',dust:'crypto',fund:'stock'},now:Date.parse(checked)};
const input=()=>({week_ending:'2026-10-21',as_of:asof,source_checked_at:checked,workbook_updated_at:'2026-10-24T12:00:00Z',workbook_sha256:'a'.repeat(64),
  mode:'historical',quantities:{gold:10,stock:1000,dust:.1,fund:0},quotes:{gold:q(200000000),stock:q(100000),dust:q(1000)},gold_quote:q(200000000),issues:[]});

test('gold-equivalent wealth uses consistent rial units and exact cutoff without rounding quantities',()=>{
  const record=calculateGoldWeek(input(),options);
  assert.equal(record.status,'complete');assert.equal(record.total_rial,2100000000);assert.equal(record.gold_grams,10.5);
  assert.equal(record.quantities.dust,.1);assert.equal(record.included_values.dust,undefined);
  assert.equal(record.allocation.gold,2000000000/2100000000*100);
  const edge=input();edge.quantities.dust=500;assert.equal(calculateGoldWeek(edge,options).included_values.dust,500000);
});

test('historical $5 cutoff uses dated FX, retains exact boundary and raw quantities, and excludes from all totals',()=>{
  const value={...input(),minimum_usd:5,usd_quote:q(1000000)};
  value.quantities.dust=1;value.quotes.dust=q(4999999);
  const record=calculateGoldWeek(value,options);
  assert.equal(record.minimum_rial,5000000);assert.equal(record.included_values.dust,undefined);
  assert.equal(record.quantities.dust,1);assert.equal(record.total_rial,2100000000);
  assert.equal(record.allocation.crypto,0);
  value.quotes.dust=q(5000000);
  assert.equal(calculateGoldWeek(value,options).included_values.dust,5000000);
  value.usd_quote=q(2000000);
  assert.equal(calculateGoldWeek(value,options).included_values.dust,undefined);
  for(const usd of [null,{...q(1),quoted_at:'2026-10-01T00:00:00Z'}, {...q(1),quoted_at:'2026-10-24T00:00:00Z'}]){
    const result=calculateGoldWeek({...value,usd_quote:usd},options);
    assert.equal(result.status,'incomplete');assert.equal(result.total_rial,null);
  }
  assert.throws(()=>calculateGoldWeek({...value,minimum_usd:6},options));
  assert.throws(()=>calculateGoldWeek({...value,mode:'live'},options));
  // A missing asset price is still unknown, never assumed to be dust.
  delete value.quotes.dust;assert.equal(calculateGoldWeek(value,options).status,'incomplete');
});

test('pre-launch zero fund needs no invented historical price; positive missing/unknown data blocks all totals and percentages',()=>{
  assert.equal(calculateGoldWeek(input(),options).status,'complete');
  for(const change of [x=>{x.quantities.fund=15;},x=>{x.quantities.stock=null;},x=>{x.gold_quote=null;},x=>{x.issues=['quantity_reconciliation_failed:stock'];}]){
    const value=input();change(value);const result=calculateGoldWeek(value,options);
    assert.equal(result.status,'incomplete');assert.equal(result.total_rial,null);assert.equal(result.gold_grams,null);assert.equal(result.allocation,null);
  }
});

test('additional historical positions contribute to totals/groups while the core holdings contract stays intact',()=>{
  const opts={...options,additionalGroups:{XAUT:'gold','اهرم':'stock'}};
  const value={...input(),additional_quantities:{XAUT:2,'اهرم':10}};
  value.quotes.XAUT=q(10000000);value.quotes['اهرم']=q(1000000);
  const record=calculateGoldWeek(value,opts);
  assert.equal(record.status,'complete');assert.equal(record.total_rial,2130000000);
  assert.equal(record.gold_grams,10.65);assert.equal(record.allocation.gold,2020000000/2130000000*100);
  assert.equal(Object.keys(record.quantities).length,4);assert.equal(record.additional_quantities.XAUT,2);
  for(const change of [x=>{delete x.additional_quantities;},x=>{x.additional_quantities.XAUT=null;},x=>{delete x.quotes.XAUT;},x=>{x.quotes.XAUT.quoted_at='2026-10-01T00:00:00Z';}]){
    const bad=structuredClone(value);change(bad);const result=calculateGoldWeek(bad,opts);
    assert.equal(result.status,'incomplete');assert.equal(result.total_rial,null);assert.equal(result.allocation,null);
  }
  const unknown=structuredClone(value);unknown.additional_quantities.Other=1;assert.throws(()=>calculateGoldWeek(unknown,opts));
  const negative=structuredClone(value);negative.additional_quantities.XAUT=-1;assert.throws(()=>calculateGoldWeek(negative,opts));
  value.minimum_usd=5;value.usd_quote=q(1000000);value.additional_quantities.XAUT=.1;value.quotes.XAUT=q(40000000);
  assert.equal(calculateGoldWeek(value,opts).included_values.XAUT,undefined);
  value.quotes.XAUT=q(50000000);assert.equal(calculateGoldWeek(value,opts).included_values.XAUT,5000000);
  value.additional_quantities['اهرم']=0;delete value.quotes['اهرم'];assert.equal(calculateGoldWeek(value,opts).status,'complete');
});

test('future/stale quotes do not turn into historical prices and invalid financial/source fields fail closed',()=>{
  for(const stamp of ['2026-10-24T00:00:00Z','2026-10-01T00:00:00Z']){
    const value=input();value.quotes.stock.quoted_at=stamp;assert.equal(calculateGoldWeek(value,options).status,'incomplete');
  }
  for(const change of [x=>{x.quantities.gold=-1;},x=>{delete x.quantities.stock;},x=>{x.workbook_sha256='no';},x=>{x.as_of='2028-01-01T00:00:00Z';},x=>{x.gold_quote.price_rial=1e-300;}]){
    const value=input();change(value);assert.throws(()=>calculateGoldWeek(value,options));
  }
});

test('weekly changes require adjacent complete weeks and immutable verified observations survive backfill',()=>{
  const a=input();a.week_ending='2026-10-07';a.as_of='2026-10-07T20:29:59Z';a.quotes=Object.fromEntries(Object.entries(a.quotes).map(([k,v])=>[k,{...v,quoted_at:a.as_of}]));a.gold_quote={...a.gold_quote,quoted_at:a.as_of};
  const c=input(),b={...a,week_ending:'2026-10-14',as_of:'2026-10-14T20:29:59Z',quantities:{...a.quantities,stock:null}};
  const weeks=mergeGoldWeeks([], [c,a,b],options);assert.equal(weeks[2].change_gold_grams,null);
  const updated=mergeGoldWeeks(weeks,[{...c,quantities:{...c.quantities,stock:null}}],options);
  assert.equal(updated[2].status,'complete');assert.equal(updated[2].gold_grams,weeks[2].gold_grams);
});

test('plot uses real dates, shows isolated points and leaves missing weeks disconnected',()=>{
  const a=calculateGoldWeek(input(),options),b={...a,week_ending:'2026-10-14',status:'incomplete',gold_grams:null},c={...a,week_ending:'2026-10-07'};
  const svg=goldHistorySvg([c,b,a],{formatTime:x=>x,escape:x=>String(x),number:x=>String(x)});
  const path=svg.match(/<path d="([^"]+)"/)[1];assert.equal((path.match(/M/g)||[]).length,2);assert.doesNotMatch(path,/L/);
  assert.match(svg,/Estedad/);assert.doesNotMatch(svg,/NaN|Infinity/);
});

const auth={'x-portfolio-sync-secret':'fixture-secondary'},header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const KEY='portfolio/gold-history/latest.json';
const request=(a,text,id=1,extra={})=>a.request('POST',{}, {message:{chat:{id,type:'private'},from:{id},text,...extra}},header);
const messages=a=>a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));

test('weekly capture includes source-verified additional positions and fails closed for a legacy worker',async()=>{
  const now=Date.parse('2026-10-25T10:00:00Z');
  for(const supplied of [true,false]){
    const a=await app({now:()=>now});
    const payload={assets:a.assets,workbook_updated_at:'2026-10-24T12:00:00Z',source_checked_at:new Date(now).toISOString(),workbook_sha256:'b'.repeat(64),bootstrap:true,notify:false};
    if(supplied){payload.additional_quantities={XAUT:2,'اهرم':0};payload.additional_quotes={XAUT:{price_rial:10000000,quoted_at:new Date(now).toISOString(),source:'Synthetic verified IRR'}};}
    const result=await a.request('POST',{sync:'gold-observation'},payload,auth);assert.equal(result.code,200);
    const record=a.store.get(KEY).weeks[0];assert.equal(record.status,supplied?'complete':'incomplete');
    assert.equal(Object.keys(record.quantities).length,29);assert.equal(Object.keys(a.assets).length,23);
    if(supplied)assert.equal(record.included_values.XAUT,20000000);
    else assert.equal(record.total_rial,null);
    assert.equal(a.sends.length,0);
  }
});
async function fixture(opts={}){
  const now=Date.now()+10000,a=await app({...opts,now:()=>now});
  a.store.set('portfolio/access-control.json',{approved:['2','3','4'],delegatedAdmins:['3'],financialAdvisors:['2'],users:{},pending:{},audit:[],accessPolicy:{version:1,activated_at:new Date(now).toISOString()}});
  const record={...input(),additional_quantities:{XAUT:0,'اهرم':0},quantities:Object.fromEntries([...a.ns.ASSETS].map(asset=>[asset,asset in a.ns.MANUAL?a.ns.MANUAL[asset]:0])),quotes:{},gold_quote:q(200000000)};
  for(const asset of Object.keys(a.ns.MANUAL))record.quotes[asset]=q(100000000);
  return {a,record,now};
}

test('history upload and configuration are authenticated, recomputed and protected against stale revisions',async()=>{
  const {a,record}=await fixture();assert.equal((await a.request('GET',{data:'gold-history'})).code,401);
  assert.equal((await a.request('POST',{sync:'gold-history'},{revision:null,weeks:[record]})).code,401);
  const result=await a.request('POST',{sync:'gold-history'},{revision:null,weeks:[record]},auth);assert.equal(result.code,200);
  const stored=a.store.get(KEY);assert.equal(stored.weeks[0].status,'complete');assert.ok(stored.weeks[0].gold_grams>0);
  const rejected=await a.request('POST',{sync:'gold-history'},{revision:null,weeks:[record]},auth);assert.equal(rejected.code,409);
  assert.equal(a.store.get(KEY).revision,stored.revision);
  assert.equal((await a.request('GET',{data:'gold-history-config'},{},auth)).data.manual_confirmation.includes('2026-10-25'),true);
});

test('only owners/admins/advisors can request a real rendered history image; guests see no history data',async()=>{
  for(const uid of [1,2,3,4,5]){
    const {a,record}=await fixture();await a.request('POST',{sync:'gold-history'},{revision:null,weeks:[record]},auth);
    await request(a,'روند ارزش بر حسب طلا',uid);
    const photo=a.sends.find(x=>x.url.endsWith('/sendPhoto'));assert.equal(!!photo,[1,2,3].includes(uid));
    if(photo){const metadata=await sharp(Buffer.from(await photo.options.body.get('photo').arrayBuffer())).metadata();assert.equal(metadata.width,1600);}
    if(uid===2)assert.equal(messages(a).some(x=>x.reply_markup?.inline_keyboard?.flat().some(b=>b.callback_data?.startsWith('history:'))),false);
  }
});

test('website-first weekly capture asks admins for missing EcoCoach price and an authenticated reply completes it',async()=>{
  const now=Date.parse('2026-10-21T20:00:00Z'),a=await app({now:()=>now});
  const assets={...a.assets,'بلک راک':15};
  const payload={assets,workbook_updated_at:'2026-10-21T12:00:00Z',source_checked_at:new Date(now).toISOString(),workbook_sha256:'b'.repeat(64),additional_quantities:{XAUT:0,'اهرم':0},bootstrap:false,notify:true};
  const result=await a.request('POST',{sync:'gold-observation'},payload,auth);assert.equal(result.code,200);
  const history=a.store.get(KEY),week=history.weeks[0];assert.equal(week.status,'incomplete');assert.equal(week.mode,'live');assert.equal(week.total_rial,null);
  const prompt=messages(a).find(x=>x.reply_markup?.force_reply);assert.ok(prompt);assert.equal(prompt.chat_id,1);
  assert.ok(a.marketCalls.includes('https://ecocoach.net/blackrock-index'));
  const promptKey=[...a.store.keys()].find(x=>x.startsWith('portfolio/gold-history/prompts/1/'));
  const messageId=Number(promptKey.split('/').at(-1).replace('.json',''));
  await request(a,'1030000',1,{reply_to_message:{message_id:messageId}});
  assert.equal(a.store.get(KEY).weeks[0].status,'complete');assert.equal(a.store.get(KEY).weeks[0].quotes['بلک راک'].price_rial,10300000);
  assert.ok(a.dispatches.some(x=>x.url.includes('gold-history.yml')));
  const previous=a.store.get(KEY).revision;await request(a,'9999999',1,{reply_to_message:{message_id:messageId}});assert.equal(a.store.get(KEY).revision,previous);
});

test('website quote suppresses the manual weekly request and no guest fixed fallback is applied',async()=>{
  const now=Date.parse('2026-10-25T10:00:00Z');
  const html=`<h1>صندوق شاخصی بلک راک اکوکوچ</h1><table><caption>صندوق شاخصی بلک راک</caption><tr><th>قیمت هر واحد</th><td>1050000 تومان</td></tr><tr><th>تاریخ به‌روزرسانی قیمت</th><td><time datetime="2026-10-25T09:00:00Z">now</time></td></tr></table>`;
  const a=await app({now:()=>now,ecoCoachHtml:html});
  const result=await a.request('POST',{sync:'gold-observation'},{assets:{...a.assets,'بلک راک':15},source_checked_at:new Date(now).toISOString(),workbook_updated_at:'2026-10-24T12:00:00Z',workbook_sha256:'b'.repeat(64),additional_quantities:{XAUT:0,'اهرم':0},bootstrap:true,notify:true},auth);
  assert.equal(result.code,200);assert.equal(a.store.get(KEY).weeks[0].status,'complete');assert.equal(a.sends.length,0);assert.equal(result.data.complete_weeks,0);assert.equal(result.data.complete_observations,1);
  assert.equal(a.store.get(KEY).weeks[0].quotes['بلک راک'].source,'EcoCoach');
});

test('history callbacks cannot expose Excel or change prices for financial advisors, guests or other chats',async()=>{
  const {a,record}=await fixture();await a.request('POST',{sync:'gold-history'},{revision:null,weeks:[record]},auth);
  const revision=a.store.get(KEY).revision;
  for(const uid of [2,4])for(const data of ['history:excel','history:price:2026-10-21'])await a.request('POST',{}, {callback_query:{id:'fixture-history',from:{id:uid},data,message:{chat:{id:uid,type:'private'}}}},header);
  assert.equal(a.sends.some(x=>x.url.endsWith('/sendDocument')),false);assert.equal(a.store.get(KEY).revision,revision);
});

test('Excel bytes round-trip privately and stale workbooks cannot be downloaded as current',async()=>{
  const {a,record}=await fixture();await a.request('POST',{sync:'gold-history'},{revision:null,weeks:[record]},auth);
  const revision=a.store.get(KEY).revision,bytes=Buffer.from('PK'+'Synthetic workbook transport fixture'.repeat(10));
  assert.equal((await a.request('GET',{data:'gold-history-file'})).code,401);
  assert.equal((await a.request('POST',{sync:'gold-history-file'},{revision:'stale',content_base64:bytes.toString('base64')},auth)).code,409);
  assert.equal((await a.request('POST',{sync:'gold-history-file'},{revision,content_base64:bytes.toString('base64')},auth)).code,200);
  const file=await a.request('GET',{data:'gold-history-file'},{},auth);assert.equal(file.code,200);
  assert.deepEqual(Buffer.from(file.data.content_base64,'base64'),bytes);assert.equal(file.data.revision,revision);
  a.store.get(KEY).revision='changed';assert.equal((await a.request('GET',{data:'gold-history-file'},{},auth)).code,409);
});

test('demotion while rendering or downloading prevents history delivery beyond the current role',async()=>{
  let a,demote=false;
  a=(await fixture({readError:key=>{
    if(demote&&key===KEY){a.store.get('portfolio/access-control.json').financialAdvisors=[];}
    return false;
  }})).a;
  const quantities=Object.fromEntries([...a.ns.ASSETS].map(asset=>[asset,null]));
  const row={...input(),quantities};for(const [asset,qty] of Object.entries(a.ns.MANUAL))quantities[asset]=qty;
  await a.request('POST',{sync:'gold-history'},{revision:null,weeks:[row]},auth);demote=true;
  await request(a,'/gold_history',2);assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
});


test('a provisional bootstrap never broadcasts weekly price requests, even if its caller asks to notify',async()=>{
  const now=Date.parse('2026-10-25T10:00:00Z'),a=await app({now:()=>now});
  const result=await a.request('POST',{sync:'gold-observation'},{assets:{...a.assets,'بلک راک':15},
    source_checked_at:new Date(now).toISOString(),workbook_updated_at:'2026-10-24T12:00:00Z',workbook_sha256:'b'.repeat(64),additional_quantities:{XAUT:0,'اهرم':0},bootstrap:true,notify:true},auth);
  assert.equal(result.code,200);assert.equal(a.store.get(KEY).weeks[0].mode,'baseline');assert.equal(a.sends.length,0);
});

test('war closure carry is instrument/date/source scoped and cannot price crypto or the gold denominator',()=>{
  const stamp='2026-05-13T20:29:59Z',old='2026-02-25T20:29:59Z';
  const opts={assets:['طعام','BTC'],groups:{'طعام':'stock',BTC:'crypto'},now:Date.parse(checked)};
  const value={...input(),week_ending:'2026-05-13',as_of:stamp,quantities:{'طعام':1000,BTC:0},
    quotes:{'طعام':{price_rial:100000,quoted_at:old,source:'Shakhesban historical daily close (IRR)'}},gold_quote:{...q(200000000),quoted_at:stamp}};
  const record=calculateGoldWeek(value,opts);
  assert.equal(record.status,'complete');assert.equal(record.total_rial,100000000);
  assert.equal(record.quotes['طعام'].quoted_at,old);assert.equal(record.quotes['طعام'].closure_id,'iran-equities-2026-war');
  assert.equal(record.quotes['طعام'].pricing_basis,'last_open_before_confirmed_closure');
  for(const change of [x=>{x.mode='live';},x=>{x.quotes['طعام'].quoted_at='2026-02-24T20:29:59Z';},
    x=>{x.quotes['طعام'].source='Owner entered price';},x=>{x.quantities.BTC=1;x.quotes.BTC={...x.quotes['طعام']};},
    x=>{x.gold_quote={...x.quotes['طعام']};},x=>{x.week_ending='2026-05-20';x.as_of='2026-05-20T20:29:59Z';x.gold_quote.quoted_at=x.as_of;}]){
    const invalid=structuredClone(value);change(invalid);const result=calculateGoldWeek(invalid,opts);
    assert.equal(result.status,'incomplete');assert.equal(result.total_rial,null);
  }
  const goldOpts={...opts,assets:['طلا','BTC'],groups:{'طلا':'gold',BTC:'crypto'}};
  const goldValue={...value,week_ending:'2026-03-11',as_of:'2026-03-11T20:29:59Z',quantities:{'طلا':1000,BTC:0},quotes:{'طلا':value.quotes['طعام']},gold_quote:{...q(200000000),quoted_at:'2026-03-11T20:29:59Z'}};
  assert.equal(calculateGoldWeek(goldValue,goldOpts).status,'complete');
  goldValue.week_ending='2026-03-18';goldValue.as_of='2026-03-18T20:29:59Z';goldValue.gold_quote.quoted_at=goldValue.as_of;
  assert.equal(calculateGoldWeek(goldValue,goldOpts).status,'incomplete');
});

test('calendar migration requires a full Wednesday grid and privately archives original Friday observations',async()=>{
  const {a,record}=await fixture();
  const legacy={version:1,revision:'legacy-friday',manual_baseline:{...a.ns.MANUAL},weeks:[{...record,week_ending:'2026-10-23',as_of:'2026-10-23T20:29:59Z',status:'complete'}]};
  a.store.set(KEY,structuredClone(legacy));
  const rows=Array.from({length:52},(_,i)=>{
    const week=new Date(Date.parse('2025-10-29T12:00:00Z')+i*7*86400000).toISOString().slice(0,10),stamp=week+'T20:29:59Z';
    return {...record,week_ending:week,as_of:stamp,gold_quote:{...record.gold_quote,quoted_at:stamp},quotes:Object.fromEntries(Object.entries(record.quotes).map(([k,v])=>[k,{...v,quoted_at:stamp}]))};
  });
  for(const payload of [{weeks:rows.slice(1),calendar:'wednesday-v1'},{weeks:rows},{weeks:[rows[0],...rows.slice(1,51),rows[0]],calendar:'wednesday-v1'}]){
    assert.equal((await a.request('POST',{sync:'gold-history'},{revision:'legacy-friday',...payload},auth)).code,400);
    assert.equal(a.store.get(KEY).revision,'legacy-friday');assert.equal(a.writes.length,0);
  }
  const result=await a.request('POST',{sync:'gold-history'},{revision:'legacy-friday',calendar:'wednesday-v1',weeks:rows},auth);
  assert.equal(result.code,200);const stored=a.store.get(KEY);assert.equal(stored.calendar,'wednesday-v1');assert.equal(stored.weeks.length,52);
  assert.ok(stored.weeks.every(w=>new Date(w.week_ending+'T12:00:00Z').getUTCDay()===3));
  assert.deepEqual(JSON.parse(JSON.stringify(a.store.get(stored.calendar_archive))),legacy);
  const archive=a.writes.find(w=>w.key===stored.calendar_archive);assert.equal(archive.options.access,'private');assert.equal(archive.options.allowOverwrite,false);
});

test('live capture rejects other days and an early Wednesday instead of relabelling their prices',async()=>{
  for(const time of ['2026-10-23T20:00:00Z','2026-10-22T00:00:00Z','2026-10-21T08:00:00Z']){
    const now=Date.parse(time),a=await app({now:()=>now});
    const result=await a.request('POST',{sync:'gold-observation'},{assets:a.assets,source_checked_at:time,workbook_updated_at:'2026-10-20T00:00:00Z',workbook_sha256:'b'.repeat(64),additional_quantities:{XAUT:0,'اهرم':0}},auth);
    assert.equal(result.code,409);assert.equal(a.writes.length,0);assert.equal(a.sends.length,0);
  }
});

test('last-known policy is explicit for weekly history, retains original dates and marks estimates',()=>{
  const old='2025-11-01T00:00:00Z',value=input();value.quotes.stock={...q(100000),quoted_at:old};
  assert.equal(calculateGoldWeek(value,options).status,'incomplete');
  const opts={...options,historicalPricePolicy:'last-known-before-valuation-v1',priceInputsRevision:'inputs-v1'};
  const record=calculateGoldWeek(value,opts);assert.equal(record.status,'complete');
  assert.equal(record.quotes.stock.quoted_at,old);assert.equal(record.quotes.stock.pricing_basis,'owner_authorized_last_known');
  assert.equal(record.valuation_basis,'estimated_last_known');assert.ok(record.estimated_assets.includes('stock'));
  assert.equal(record.price_inputs_revision,'inputs-v1');
  assert.equal(calculateGoldWeek({...value,mode:'live'},options).status,'incomplete');
  assert.equal(calculateGoldWeek({...value,mode:'live'},opts).valuation_basis,'estimated_last_known');
  value.quotes.stock.quoted_at='2026-10-22T00:00:00Z';assert.equal(calculateGoldWeek(value,opts).status,'incomplete');
  const svg=goldHistorySvg([record],{formatTime:x=>x,escape:x=>String(x),number:x=>String(x)});
  assert.match(svg,/برآورد/);assert.doesNotMatch(svg,/مقدار تأییدشده/);
});

test('a completed estimate upgrades with newer data but cannot be replaced by an incomplete reconstruction',()=>{
  const opts={...options,historicalPricePolicy:'last-known-before-valuation-v1',priceInputsRevision:'inputs-v1'};
  const value=input();value.quotes.stock.quoted_at='2025-11-01T00:00:00Z';
  const estimated=calculateGoldWeek(value,opts),fresh=input();fresh.quotes.stock.price_rial=200000;
  const changed=mergeGoldWeeks([estimated],[fresh],opts)[0];assert.equal(changed.total_rial,2200000000);assert.equal(changed.valuation_basis,'dated_prices');
  const invalid=input();delete invalid.quotes.stock;assert.equal(mergeGoldWeeks([estimated],[invalid],opts)[0].gold_grams,estimated.gold_grams);
});

test('owner price input endpoint requires auth, currency, dates and revision and stores prices privately',async()=>{
  const {a,record}=await fixture();await a.request('POST',{sync:'gold-history'},{revision:null,weeks:[record]},auth);
  const revision=a.store.get(KEY).revision;
  const p={asset:'بلک راک',price_rial:10000,original_price:1000,original_currency:'TOMAN',quoted_at:asof,document_sha256:'a'.repeat(64)};
  const body={revision,historical_price_policy:'last-known-before-valuation-v1',price_inputs:[p]};
  assert.equal((await a.request('POST',{sync:'gold-history-prices'},body)).code,401);
  for(const change of [x=>{x.revision='stale';},x=>{x.price_inputs[0].original_currency='unknown';},
    x=>{x.price_inputs[0].price_rial=1000;},x=>{x.price_inputs[0].quoted_at='2030-01-01T00:00:00Z';},
    x=>{x.price_inputs[0].asset='unknown';},x=>{x.price_inputs.push({...p});}]){
    const invalid=structuredClone(body);change(invalid);assert.ok([400,409].includes((await a.request('POST',{sync:'gold-history-prices'},invalid,auth)).code));
    assert.equal(a.store.get(KEY).revision,revision);
  }
  const result=await a.request('POST',{sync:'gold-history-prices'},body,auth);assert.equal(result.code,200);
  const stored=a.store.get(KEY);assert.equal(stored.price_inputs.length,1);assert.equal(stored.price_inputs[0].price_rial,10000);
  assert.equal(stored.price_inputs[0].source,'Owner supplied dated historical unit price');assert.equal(stored.historical_price_policy,body.historical_price_policy);
  assert.equal(a.sends.length,0);assert.equal((await a.request('GET',{data:'gold-history'})).code,401);
  const next={revision:stored.revision,weeks:[record]};await a.request('POST',{sync:'gold-history'},next,auth);
  assert.equal(a.store.get(KEY).price_inputs.length,1);assert.equal(a.store.get(KEY).price_inputs_revision,stored.price_inputs_revision);
});


test('stored weekly fallback never borrows quantities or future prices and keeps unknown balances incomplete',()=>{
  const opts={...options,historicalPricePolicy:'last-known-before-valuation-v1',priceInputsRevision:'v1'};
  const past=input();past.week_ending='2026-10-14';past.as_of='2026-10-14T20:29:59Z';
  for(const p of Object.values(past.quotes))p.quoted_at=past.as_of;past.gold_quote.quoted_at=past.as_of;
  const live={...input(),mode:'live',quotes:{},gold_quote:null};live.quantities.stock=2000;
  const result=applyHistoryPriceFallbacks([calculateGoldWeek(past,options),calculateGoldWeek(live,options)],[],opts);
  assert.equal(result[1].status,'complete');assert.equal(result[1].quantities.stock,2000);assert.equal(result[1].total_rial,2200000000);
  assert.equal(result[1].valuation_basis,'estimated_last_known');assert.equal(result[1].quotes.stock.quoted_at,past.as_of);
  const unknown=structuredClone(live);unknown.quantities.stock=null;
  assert.equal(applyHistoryPriceFallbacks([result[0],calculateGoldWeek(unknown,options)],[],opts)[1].status,'incomplete');
  const onlyFuture=applyHistoryPriceFallbacks([calculateGoldWeek(live,options)],[],opts)[0];assert.equal(onlyFuture.status,'incomplete');
  const override={asset:'stock',price_rial:200000,source:'Owner supplied dated historical unit price',quoted_at:past.as_of};
  assert.equal(applyHistoryPriceFallbacks([result[0]],[override],opts)[0].total_rial,2200000000);
  override.quoted_at='2026-10-15T00:00:00Z';assert.equal(applyHistoryPriceFallbacks([result[0]],[override],opts)[0].total_rial,2100000000);
});

test('weekly EcoCoach request still replaces a last-known estimate when current market providers fail',async()=>{
  const now=Date.parse('2026-10-21T20:00:00Z'),a=await app({now:()=>now,beforeMarketFetch:()=>{throw new Error('Synthetic provider outage');}});
  const assets=Object.fromEntries(Object.keys(a.assets).map(k=>[k,k==='بلک راک'?15:0]));
  const past={...input(),week_ending:'2026-10-14',as_of:'2026-10-14T20:00:00Z',source_checked_at:'2026-10-21T19:59:00Z',workbook_updated_at:'2026-10-13T00:00:00Z',
    quantities:{...assets,...a.ns.MANUAL},additional_quantities:{XAUT:0,'اهرم':0},quotes:{},gold_quote:{...q(200000000),quoted_at:'2026-10-14T20:00:00Z'}};
  for(const asset of [...Object.keys(a.ns.MANUAL),'بلک راک'])past.quotes[asset]={...q(10000000),quoted_at:past.as_of};
  assert.equal((await a.request('POST',{sync:'gold-history'},{revision:null,weeks:[past]},auth)).code,200);
  const state=a.store.get(KEY);
  assert.equal((await a.request('POST',{sync:'gold-history-prices'},{revision:state.revision,historical_price_policy:'last-known-before-valuation-v1',price_inputs:[{asset:'بلک راک',price_rial:10000000,original_price:1000000,original_currency:'TOMAN',quoted_at:past.as_of,document_sha256:'b'.repeat(64)}]},auth)).code,200);
  const result=await a.request('POST',{sync:'gold-observation'},{assets,source_checked_at:new Date(now).toISOString(),workbook_updated_at:'2026-10-20T00:00:00Z',workbook_sha256:'b'.repeat(64),additional_quantities:{XAUT:0,'اهرم':0},notify:true},auth);
  assert.equal(result.code,200);let current=a.store.get(KEY).weeks.at(-1);
  assert.equal(current.status,'complete');assert.equal(current.valuation_basis,'estimated_last_known');assert.equal(current.quotes['بلک راک'].pricing_basis,'owner_authorized_last_known');
  const prompt=messages(a).find(x=>x.reply_markup?.force_reply);assert.ok(prompt);
  const promptKey=[...a.store.keys()].find(x=>x.startsWith('portfolio/gold-history/prompts/1/'));
  const id=Number(promptKey.split('/').at(-1).replace('.json',''));
  await request(a,'1030000',1,{reply_to_message:{message_id:id}});
  current=a.store.get(KEY).weeks.at(-1);assert.equal(current.quotes['بلک راک'].price_rial,10300000);
  assert.equal(current.quotes['بلک راک'].pricing_basis,undefined);assert.equal(current.valuation_basis,'estimated_last_known');
});
