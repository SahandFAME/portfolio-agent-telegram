import test from 'node:test';
import assert from 'node:assert/strict';
import {app as sharedApp,completeFreshReport} from './helpers/app-fixture.mjs';
async function app(){const a=await sharedApp();return a;}

const buttons=[['آخرین ترکیب دارایی','/latest_allocation'],['وضعیت','/status'],['دارایی‌ها','/assets'],['طلا و سایر فلزات گرانبها','/gold_and_other_precious_metals'],['رمزارز','/crypto'],['دلار نقدی','/cash_dollar'],['نمودار ترکیب دارایی','/allocation_chart'],['روند ارزش بر حسب طلا','/gold_history'],['راهنما','/help']];
const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const message=(text,id=1,type='private')=>({message:{chat:{id,type},from:{id},text}});

for(const [label,command] of buttons) test(`button ${label} runs ${command} with the same output`,async()=>{
  const a=await app();a.payload.assets['بلک راک']=15;a.store.set('portfolio/latest.json',a.payload);
  await a.request('POST',{},message(command),header);
  const expected=a.sends.map(x=>JSON.parse(x.options.body).text).join('\n');a.sends.length=0;a.store.delete('portfolio/latest-allocation/active/1.json');
  await a.request('POST',{},message(label),header);
  const actual=a.sends.map(x=>JSON.parse(x.options.body).text).join('\n');
  const withoutRetrievalTime=text=>text.replace(/Prices retrieved: [^\n]+/g,'Prices retrieved: <fresh timestamp>');
  assert.equal(withoutRetrievalTime(actual),withoutRetrievalTime(expected));
  assert.ok(a.sends.length);
  for(const sent of a.sends){
    const keyboard=JSON.parse(sent.options.body).reply_markup;if(!keyboard?.keyboard)continue;
    assert.equal(keyboard.is_persistent,false);assert.equal(keyboard.one_time_keyboard,false);assert.equal(keyboard.resize_keyboard,true);
    assert.deepEqual(keyboard.keyboard.flat().map(x=>x.text),[...buttons.map(x=>x[0]),'پنل مدیریت']);
  }
});

for(const command of ['/start','/help','/menu']) test(`${command} exposes the reusable menu`,async()=>{
  const a=await app();await a.request('POST',{},message(command),header);
  const reply=JSON.parse(a.sends[0].options.body);
  assert.ok(reply.reply_markup.keyboard.length===6);assert.match(reply.text,/دکمه‌های منو/);
  assert.deepEqual(reply.reply_markup.keyboard[0],[{text:'آخرین ترکیب دارایی'}]);
  assert.ok(reply.reply_markup.keyboard.slice(1,4).every(row=>row.length===2));
  assert.deepEqual(reply.reply_markup.keyboard.at(-1),[{text:'راهنما'},{text:'پنل مدیریت'}]);
  assert.ok(reply.text.includes('/cash_dollar — Cash Dollar (دلار نقدی)\n\nبرای تهیه گزارش ارزش‌گذاری'));
  assert.ok(reply.text.includes('بلک راک* (EcoCoach)'));
  assert.equal(reply.text.includes('\\n'),false);
});

test('menu selections do not bypass private-chat or user access controls',async()=>{
  for(const [label] of buttons){
    const a=await app();await a.request('POST',{},message(label,2),header);
    const replies=a.sends.map(x=>JSON.parse(x.options.body)).filter(x=>x.chat_id===2);
    assert.equal(replies.length,1);const reply=replies[0];
    assert.match(reply.text,/private|access request/);assert.equal(reply.reply_markup.remove_keyboard,true);
    assert.doesNotMatch(reply.text,/دارایی‌های پرتفوی|Snapshot|تعداد: 15/);
    const b=await app();await b.request('POST',{},message(label,1,'group'),header);
    assert.equal(b.sends.length,0);
  }
});

test('valuation buttons retain stale quantity protection',async()=>{
  for(const label of ['طلا و سایر فلزات گرانبها','رمزارز','دلار نقدی']){
    const a=await app();a.store.set('portfolio/latest.json',{...a.payload,updated_at:'2020-01-01T00:00:00Z'});
    await a.request('POST',{},message(label),header);
    assert.match(JSON.parse(a.sends[0].options.body).text,/در حال دریافت تازه‌ترین/);assert.equal(a.marketCalls.length,0);
  }
});

test('asset button replaces an old EcoCoach prompt with a fresh quantity request',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',a.payload);
  a.store.set('portfolio/pending-blackrock/1.json',{type:'blackrock_price'});
  await a.request('POST',{},message('دارایی‌ها'),header);
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'latest_sync_pending');
  await a.request('POST',{},message('850000'),header);
  assert.equal(a.marketCalls.length,0);assert.equal(a.dispatches.length,1);
  await completeFreshReport(a);
  assert.match(JSON.parse(a.sends.filter(x=>x.url.endsWith('/sendMessage')).at(-1).options.body).text,/دارایی‌های پرتفوی/);
});
