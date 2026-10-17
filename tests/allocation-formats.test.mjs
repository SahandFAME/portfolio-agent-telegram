import test from 'node:test';
import assert from 'node:assert/strict';
import {app,startLatest} from './helpers/app-fixture.mjs';

const ACCESS_POLICY_STARTED_AT=new Date().toISOString();

const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const auth={'x-portfolio-sync-secret':'fixture-secondary'};
const messages=a=>a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));
const message=(text,id=1,type='private')=>({message:{chat:{id,type},from:{id},text}});
const callback=(data,id=1,chatId=id,type='private')=>({callback_query:{id:'fixture',data,from:{id},message:{chat:{id:chatId,type}}}});
const selected=a=>JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
const key=id=>'portfolio/latest-allocation/requests/'+id+'.json';
async function complete(a,id=selected(a),{ok=true,mismatch=false}={}){
  const snapshot={...a.payload,assets:{...Object.fromEntries(Object.keys(a.assets).map(asset=>[asset,1])),'بلک راک':15},updated_at:new Date().toISOString()};
  a.store.set('portfolio/latest.json',snapshot);
  return a.request('POST',{complete:'latest-allocation'},{request_id:id,ok,
    snapshot_updated_at:mismatch?'changed':snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},auth);
}
const chooseData=a=>messages(a).at(-1).reply_markup.inline_keyboard.flat().find(x=>x.text==='گزارش متنی').callback_data;

test('latest composition opens a private picture/text submenu without dispatching or pricing',async()=>{
  const a=await app();await a.request('POST',{},message('آخرین ترکیب دارایی'),header);
  const menu=messages(a).at(-1);
  assert.deepEqual(menu.reply_markup.inline_keyboard.flat().map(x=>x.text),['گزارش تصویری','گزارش متنی','بازگشت به منوی اصلی']);
  assert.equal(a.dispatches.length,0);assert.equal(a.marketCalls.length,0);
  const anchor=a.store.get('portfolio/main-menu/1.json').message_id;
  const data=chooseData(a);await a.request('POST',{},callback(data),header);
  assert.equal(a.dispatches.length,1);assert.equal(a.marketCalls.length,0);
  assert.equal(a.store.get(key(selected(a))).report_format,'text');
  assert.equal(a.sends.filter(x=>x.url.endsWith('/deleteMessage')).some(x=>JSON.parse(x.options.body).message_id===anchor),false);
});

test('text choice survives the EcoCoach prompt and refreshes quantities again before details and percentages',async()=>{
  const a=await app();await startLatest(a,{format:'text'});await complete(a);
  const prompt=messages(a).at(-1);assert.match(prompt.text,/قیمت فعلی هر واحد صندوق بلک/);
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').report_format,'text');
  const prior=a.marketCalls.length;const first=selected(a);
  await a.request('POST',{},message('۸۵۰۰۰۰ تومان'),header);const second=selected(a);
  assert.notEqual(first,second);assert.equal(a.dispatches.length,2);assert.equal(a.marketCalls.length,prior);
  assert.equal(a.store.get(key(second)).report_format,'text');
  await complete(a,second);
  const details=messages(a).filter(x=>/گزارش تفصیلی|ادامه گزارش/.test(x.text));
  assert.ok(details.length>=1);assert.ok(details.every(x=>x.text.length<=3500&&x.parse_mode==='HTML'));
  const full=details.map(x=>x.text).join('\n');
  const listed=[...full.matchAll(/^[۰-۹]+\. <b>([^<]+)<\/b>$/gm)].map(match=>match[1].replace(/\*$/,''));
  assert.deepEqual(listed,[...a.ns.ASSETS]);
  assert.equal((full.match(/مقدار:/g)||[]).length,29);assert.equal((full.match(/گروه:/g)||[]).length,29);
  assert.equal((full.match(/ارزش: <b>/g)||[]).length,29);
  const percentages=messages(a).at(-1);assert.ok(percentages.text.startsWith('<b>درصد گروه‌های دارایی</b>'));
  assert.equal((percentages.text.match(/٪/g)||[]).length,6);
  assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'none');
});

test('text values and category percentages use the same complete valuation and toman conversion',async()=>{
  const a=await app();const q=Object.fromEntries([...a.ns.ASSETS].map((asset,i)=>[asset,i+1]));
  q.BTC=0.00519153;q.ETH=0.40602;
  const report=await a.ns.prepareAllocation(q,100000);const output=await a.ns.latestAllocationReport(q,100000,'text',a.payload);
  assert.equal(output.total,report.total);
  const expected=Object.fromEntries([...a.ns.ASSETS].map(asset=>[asset,a.ns.valueRial(asset,q[asset],report.prices[asset],report.usdIrr)]));
  assert.equal(report.total,Object.values(expected).filter(value=>value>=500000).reduce((sum,value)=>sum+value,0));
  const all=output.messages.join('\n');
  for(const asset of a.ns.visibleReportAssets(report.vals)){assert.ok(all.includes('ارزش: <b>'+Math.round(expected[asset]/10).toLocaleString('fa-IR',{maximumFractionDigits:0}).replace(/٬/g,'،')+' تومان</b>'));}
  assert.doesNotMatch(all,/\. <b>BTC<\/b>/);assert.ok(all.includes('مقدار: ۰٫۴۰۶۰۲ ETH'));
  const groups=a.ns.allocationGroups(report.vals,report.total);
  assert.ok(Math.abs(groups.reduce((sum,g)=>sum+g.percentage,0)-100)<1e-10);
  assert.equal(groups.reduce((sum,g)=>sum+g.value,0),report.total);
  const stocks=groups.find(g=>g.category==='سهام و صندوق');
  assert.equal(stocks.value,['نهال','طعام','استیل','فلز فارابی','پتروآگاه','خودران','بلک راک','سجام','فملی'].reduce((sum,asset)=>sum+expected[asset],0));
  for(const group of groups){assert.ok(output.percentages.includes(group.percentage.toLocaleString('fa-IR',{minimumFractionDigits:2,maximumFractionDigits:2})+'٪'));}
});

test('return from format menu restores main buttons without starting any job',async()=>{
  const a=await app();await a.request('POST',{},message('/latest_allocation'),header);
  const data=messages(a).at(-1).reply_markup.inline_keyboard.flat().find(x=>x.text==='بازگشت به منوی اصلی').callback_data;
  await a.request('POST',{},callback(data),header);
  assert.ok(messages(a).at(-1).reply_markup.keyboard);assert.equal(a.dispatches.length,0);
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'none');
});

test('unapproved, revoked, cross-chat and group callbacks cannot choose formats',async()=>{
  const a=await app();await a.request('POST',{},message('/latest_allocation'),header);const data=chooseData(a);
  for(const forged of [callback(data,2),callback(data,1,2),callback(data,1,1,'group')])await a.request('POST',{},forged,header);
  assert.equal(a.dispatches.length,0);
  const b=await app();b.store.set('portfolio/access-control.json',{accessPolicy:{version:1,activated_at:ACCESS_POLICY_STARTED_AT},approved:['2'],pending:{},delegatedAdmins:['2'],users:{},audit:[]});
  await b.request('POST',{},message('/latest_allocation',2),header);const choice=chooseData(b);
  b.store.get('portfolio/access-control.json').approved=[];await b.request('POST',{},callback(choice,2),header);
  assert.equal(b.dispatches.length,0);
});

test('expired, replaced and used selection buttons cannot dispatch another report',async()=>{
  for(const scenario of ['expired','replaced','used']){
    const a=await app();await a.request('POST',{},message('/latest_allocation'),header);const data=chooseData(a);
    if(scenario==='expired')a.store.get('portfolio/latest-allocation/selections/1.json').created_at='2020-01-01T00:00:00Z';
    if(scenario==='replaced')await a.request('POST',{},message('/latest_allocation'),header);
    if(scenario==='used')await a.request('POST',{},callback(data),header);
    const count=a.dispatches.length;await a.request('POST',{},callback(data),header);assert.equal(a.dispatches.length,count);
  }
});

test('failed synchronization and mismatched snapshots never send text values or percentages',async()=>{
  for(const scenario of ['failure','mismatch']){
    const a=await app();await startLatest(a,{format:'text'});await complete(a,selected(a),{ok:scenario!=='failure',mismatch:scenario==='mismatch'});
    assert.equal(a.marketCalls.length,0);assert.equal(messages(a).some(x=>/گزارش تفصیلی|درصد گروه‌های/.test(x.text)),false);
  }
});

test('missing market data blocks totals, percentages and pictures for every report format',async()=>{
  const a=await app({beforeMarketFetch:url=>{if(String(url).includes('price_dollar_rl'))throw new Error('fixture missing USD');}});
  const q={...a.assets,...a.ns.MANUAL};
  for(const format of ['image','text','chart']){
    const report=await a.ns.latestAllocationReport(q,100000,format);assert.ok(report.text);assert.equal(report.png,undefined);
    assert.equal(report.messages,undefined);assert.equal(report.percentages,undefined);assert.equal(report.total,undefined);
  }
});

test('failed text chunk delivery never sends percentage message',async()=>{
  const a=await app({telegramReply:call=>call.url.endsWith('/sendMessage')&&JSON.parse(call.options.body).text.includes('ادامه گزارش')?{ok:false,status:500}:null});
  await startLatest(a,{format:'text'});a.store.get(key(selected(a))).blackRockPriceRial=100000;
  await complete(a);
  assert.ok(messages(a).some(x=>x.text.includes('ادامه گزارش')));
  assert.equal(messages(a).some(x=>x.text.startsWith('<b>درصد گروه‌های')),false);
});

test('changing the selected format supersedes a queued job and cannot deliver the previous format',async()=>{
  const a=await app();await startLatest(a,{format:'image'});const image=selected(a);
  await startLatest(a,{format:'text'});const text=selected(a);
  assert.notEqual(image,text);assert.equal(a.dispatches.length,2);
  const old=await complete(a,image);assert.equal(old.data.ignored,true);assert.equal(a.marketCalls.length,0);
  a.store.get(key(text)).blackRockPriceRial=100000;await complete(a,text);
  assert.ok(messages(a).some(x=>x.text.startsWith('<b>گزارش تفصیلی')));
  assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
});

test('access revocation or supersession during a text report stops remaining chunks and percentages',async()=>{
  for(const scenario of ['revoked','superseded']){
    let a;
    a=await app({telegramReply:call=>{
      if(call.url.endsWith('/sendMessage')&&JSON.parse(call.options.body).text.startsWith('<b>گزارش تفصیلی')){
        if(scenario==='revoked')a.store.get('portfolio/access-control.json').approved=[];
        else a.store.set('portfolio/latest-allocation/active/2.json',{request_id:'newer-job'});
      }return null;
    }});
    a.store.set('portfolio/access-control.json',{accessPolicy:{version:1,activated_at:ACCESS_POLICY_STARTED_AT},approved:['2'],pending:{},delegatedAdmins:['2'],users:{},audit:[]});
    await startLatest(a,{id:2,format:'text'});a.store.get(key(selected(a))).blackRockPriceRial=100000;
    await complete(a);
    assert.ok(messages(a).some(x=>x.text.startsWith('<b>گزارش تفصیلی')));
    assert.equal(messages(a).some(x=>/ادامه گزارش|درصد گروه‌های/.test(x.text)),false);
  }
});
