import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/app-fixture.mjs';

const headers={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const aliases=['/cash_dollar','دلار نقدی','Cash Dollar','/cash','نقدینگی'];
async function report(a,text,id=1,type='private'){
  await a.request('POST',{}, {message:{chat:{id,type},from:{id},text}},headers);
  return a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body)).at(-1);
}

test('Cash Dollar command, Persian button and legacy aliases give the same dollar valuation',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',a.payload);
  const before=JSON.stringify(a.store.get('portfolio/latest.json'));
  const {prices}=await a.ns.getPrices();
  let expected;
  for(const text of aliases){
    const reply=await report(a,text);assert.ok(reply.text.startsWith('دلار نقدی\n'));
    assert.ok(reply.text.includes('Subtotal: '+(a.ns.MANUAL['دلار']*prices['دلار'].priceRial/10).toLocaleString('en-US',{maximumFractionDigits:8})+' toman'));
    assert.doesNotMatch(reply.text,/Tether|EcoCoach|بلک راک/);
    const normalized=reply.text.replace(/Prices retrieved: [^\n]+/g,'Prices retrieved: <timestamp>');
    expected??=normalized;assert.equal(normalized,expected);
    const labels=reply.reply_markup.keyboard.flat().map(x=>x.text);
    assert.ok(labels.includes('دلار نقدی'));assert.equal(labels.includes('نقدینگی'),false);
  }
  assert.equal(JSON.stringify(a.store.get('portfolio/latest.json')),before);
  assert.equal(a.dispatches.length,0);
  const help=await report(a,'/help');assert.ok(help.text.includes('/cash_dollar — Cash Dollar (دلار نقدی)'));
});

test('all Cash Dollar aliases preserve stale snapshot blocking',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',{...a.payload,updated_at:'2020-01-01T00:00:00Z'});
  for(const text of aliases){
    const reply=await report(a,text);assert.match(reply.text,/قدیمی یا نامعتبر/);
    assert.doesNotMatch(reply.text,/Subtotal|Prices retrieved/);
  }
  assert.equal(a.marketCalls.length,0);
});

test('all Cash Dollar aliases preserve access restrictions and private-chat requirements',async()=>{
  for(const text of aliases){
    const a=await app();const reply=await report(a,text,2);
    assert.match(reply.text,/private/);assert.equal(reply.reply_markup.remove_keyboard,true);
    assert.doesNotMatch(reply.text,/Subtotal|دلار نقدی/);assert.equal(a.marketCalls.length,0);
    const b=await app();await report(b,text,1,'group');assert.equal(b.sends.length,0);
  }
});
