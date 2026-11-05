import test from 'node:test';
import assert from 'node:assert/strict';
import {app,completeFreshReport} from './helpers/app-fixture.mjs';

const headers={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const aliases=['/cash_dollar','دلار نقدی','Cash Dollar','/cash','نقدینگی'];
async function report(a,text,id=1,type='private'){
  await a.request('POST',{}, {message:{chat:{id,type},from:{id},text}},headers);
  await completeFreshReport(a,{id});
  return a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body)).at(-1);
}

test('Cash Dollar command, Persian button and legacy aliases give the same dollar valuation',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',a.payload);
  const before=JSON.stringify(a.store.get('portfolio/latest.json'));
  const {prices}=await a.ns.getPrices();
  let expected;
  for(const text of aliases){
    const reply=await report(a,text);assert.ok(reply.text.startsWith('<b>گزارش تفصیلی دلار نقدی</b>\n'));
    assert.ok(reply.text.includes('ارزش کل دارایی‌های این گزارش: <b>'+(a.ns.MANUAL['دلار']*prices['دلار'].priceRial/10).toLocaleString('fa-IR',{maximumFractionDigits:0}).replace(/٬/g,'،')+' تومان</b>'));
    assert.doesNotMatch(reply.text,/Tether|EcoCoach|بلک راک/);
    const normalized=reply.text.replace(/(قیمت‌های بازار|آخرین همگام‌سازی مقادیر): [^\n]+/g,'<timestamp>');
    expected??=normalized;assert.equal(normalized,expected);
    const labels=reply.reply_markup.keyboard.flat().map(x=>x.text);
    assert.ok(labels.includes('دلار نقدی'));assert.equal(labels.includes('نقدینگی'),false);
  }
  assert.deepEqual(a.store.get('portfolio/latest.json').assets,a.assets);
  assert.equal(a.dispatches.length,aliases.length);
  const help=await report(a,'/help');assert.ok(help.text.includes('/cash_dollar — Cash Dollar (دلار نقدی)'));
});

test('all Cash Dollar aliases preserve stale snapshot blocking',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',{...a.payload,updated_at:'2020-01-01T00:00:00Z'});
  for(const text of aliases){
    await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text}},headers);await completeFreshReport(a,{ok:false});const reply=JSON.parse(a.sends.filter(x=>x.url.endsWith('/sendMessage')).at(-1).options.body);assert.match(reply.text,/دریافت تازه ناموفق/);
    assert.doesNotMatch(reply.text,/ارزش کل دارایی‌های این گزارش|قیمت‌های بازار/);
  }
  assert.equal(a.marketCalls.length,0);
});

test('all Cash Dollar aliases preserve access restrictions and private-chat requirements',async()=>{
  for(const text of aliases){
    const a=await app();const reply=await report(a,text,2);
    assert.match(reply.text,/private/);assert.equal(reply.reply_markup.remove_keyboard,true);
    assert.doesNotMatch(reply.text,/ارزش کل دارایی‌های این گزارش|دلار نقدی/);assert.equal(a.marketCalls.length,0);
    const b=await app();await report(b,text,1,'group');assert.equal(b.sends.length,0);
  }
});
