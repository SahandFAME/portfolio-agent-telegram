import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {calculateGoldWeek,mergeGoldWeeks,goldHistorySvg} from '../lib/gold-history.js';
import {app} from './helpers/app-fixture.mjs';

const checked='2026-10-25T09:00:00Z',asof='2026-10-23T20:29:59Z';
const q=p=>({price_rial:p,source:'Synthetic verified quote',quoted_at:asof});
const options={assets:['gold','stock','dust','fund'],groups:{gold:'gold',stock:'stock',dust:'crypto',fund:'stock'},now:Date.parse(checked)};
const input=()=>({week_ending:'2026-10-23',as_of:asof,source_checked_at:checked,workbook_updated_at:'2026-10-24T12:00:00Z',workbook_sha256:'a'.repeat(64),
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
  const a=input();a.week_ending='2026-10-09';a.as_of='2026-10-09T20:29:59Z';a.quotes=Object.fromEntries(Object.entries(a.quotes).map(([k,v])=>[k,{...v,quoted_at:a.as_of}]));a.gold_quote={...a.gold_quote,quoted_at:a.as_of};
  const c=input(),b={...a,week_ending:'2026-10-16',as_of:'2026-10-16T20:29:59Z',quantities:{...a.quantities,stock:null}};
  const weeks=mergeGoldWeeks([], [c,a,b],options);assert.equal(weeks[2].change_gold_grams,null);
  const updated=mergeGoldWeeks(weeks,[{...c,quantities:{...c.quantities,stock:null}}],options);
  assert.equal(updated[2].status,'complete');assert.equal(updated[2].gold_grams,weeks[2].gold_grams);
});

test('plot uses real dates, shows isolated points and leaves missing weeks disconnected',()=>{
  const a=calculateGoldWeek(input(),options),b={...a,week_ending:'2026-10-16',status:'incomplete',gold_grams:null},c={...a,week_ending:'2026-10-09'};
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
  const now=Date.parse('2026-10-24T00:00:00Z'),a=await app({now:()=>now});
  const assets={...a.assets,'بلک راک':15};
  const payload={assets,workbook_updated_at:'2026-10-23T12:00:00Z',source_checked_at:new Date(now).toISOString(),workbook_sha256:'b'.repeat(64),additional_quantities:{XAUT:0,'اهرم':0},bootstrap:false,notify:true};
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
  for(const uid of [2,4])for(const data of ['history:excel','history:price:2026-10-23'])await a.request('POST',{}, {callback_query:{id:'fixture-history',from:{id:uid},data,message:{chat:{id:uid,type:'private'}}}},header);
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
