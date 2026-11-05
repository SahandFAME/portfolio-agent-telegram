import test from 'node:test';
import assert from 'node:assert/strict';
import {app,completeFreshReport} from './helpers/app-fixture.mjs';
const headers={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const auth={'x-portfolio-sync-secret':'fixture-secondary'};
const command=(a,text,id=1)=>a.request('POST',{}, {message:{chat:{id,type:'private'},from:{id},text}},headers);
const messages=a=>a.sends.filter(s=>s.url.endsWith('/sendMessage')).map(s=>JSON.parse(s.options.body));
const record=a=>a.store.get('portfolio/latest-allocation/requests/'+a.store.get('portfolio/latest-allocation/active/1.json').request_id+'.json');
const formats=[['/assets','assets'],['/gold','metals'],['/gold_and_other_precious_metals','metals'],['/crypto','crypto'],['/cash_dollar','cash'],['/gold_history','history']];
for(const [cmd,format] of formats){
  test(`${cmd} dispatches a fresh source read even when the cached snapshot was just updated`,async()=>{
    const a=await app();a.store.set('portfolio/latest.json',a.payload);
    await command(a,cmd);assert.equal(a.dispatches.length,1);assert.equal(a.marketCalls.length,0);
    assert.equal(record(a).report_format,format);
    const inputs=JSON.parse(a.dispatches[0].options.body).inputs;
    assert.equal(inputs.report_type,format==='history'?'history':undefined);
    assert.equal(messages(a).some(m=>/گزارش تفصیلی|دارایی‌های پرتفوی|خلاصه روند ماهانه/.test(m.text)),false);
    await command(a,cmd);assert.equal(a.dispatches.length,1);
  });
  test(`${cmd} refuses cached output when the fresh source job fails`,async()=>{
    const a=await app();a.store.set('portfolio/latest.json',a.payload);await command(a,cmd);
    await completeFreshReport(a,{ok:false});assert.equal(a.marketCalls.length,0);
    assert.match(messages(a).at(-1).text,/دریافت تازه ناموفق/);
    assert.equal(a.sends.some(s=>s.url.endsWith('/sendPhoto')),false);
  });
}
for(const [cmd,expected] of [['/assets','BTC: 12'],['/crypto','مقدار: ۱۲ BTC'],['/gold','مقدار: ۵۰۰ سهم'],['/cash_dollar','مقدار: ۳،۰۳۰']]){
  test(`${cmd} uses verified refreshed quantities and preserves manual holdings`,async()=>{
    const a=await app();a.store.set('portfolio/latest.json',{...a.payload,assets:{...a.assets,BTC:1,'طلا':1}});
    await command(a,cmd);
    await completeFreshReport(a,{assets:{...a.assets,BTC:12,'طلا':500}});
    const text=messages(a).map(m=>m.text).join('\n');
    if(cmd==='/cash_dollar')assert.match(text,/مقدار: ۳[٬،]۰۳۰ دلار/);else assert.ok(text.includes(expected),text);
    assert.ok(a.marketCalls.length>0);assert.equal(a.store.get('portfolio/latest.json').assets.BTC,12);
    assert.equal(a.ns.MANUAL['دلار'],3030);
  });
}
test('a newer category request supersedes the previous report and late callbacks cannot deliver it',async()=>{
  const a=await app();await command(a,'/crypto');const old=record(a);
  await command(a,'/gold');assert.equal(a.dispatches.length,2);
  const result=await a.request('POST',{complete:'latest-allocation'},{request_id:old.request_id,ok:true},auth);
  assert.equal(result.data.ignored,true);assert.equal(a.marketCalls.length,0);
  await completeFreshReport(a);assert.match(messages(a).at(-1).text,/طلا و فلزات گرانبها/);
});
test('revocation between request and refresh prevents category pricing and delivery',async()=>{
  const a=await app();a.store.set('portfolio/access-control.json',{approved:['2'],financialAdvisors:['2'],delegatedAdmins:[],users:{},pending:{},audit:[],accessPolicy:{version:1,activated_at:new Date().toISOString()}});
  await command(a,'/crypto',2);a.store.get('portfolio/access-control.json').approved=[];
  const before=a.sends.length;await completeFreshReport(a,{id:2,keepWaiting:true});
  assert.equal(a.sends.length,before);assert.equal(a.marketCalls.length,0);
});
test('history cannot present an older chart when its refresh revision was not confirmed',async()=>{
  const a=await app();await command(a,'/gold_history');
  const r=record(a),snapshot={...a.payload,updated_at:r.requested_at};a.store.set('portfolio/latest.json',snapshot);
  a.store.set('portfolio/gold-history/latest.json',{revision:'newer',weeks:[]});
  await a.request('POST',{complete:'latest-allocation'},{request_id:r.request_id,ok:true,snapshot_updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at,history_revision:'older'},auth);
  assert.equal(a.sends.some(s=>s.url.endsWith('/sendPhoto')),false);assert.match(messages(a).at(-1).text,/ناموفق/);
});
