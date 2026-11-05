import test from 'node:test';
import assert from 'node:assert/strict';
import {app as sharedApp,completeFreshReport} from './helpers/app-fixture.mjs';
async function app(){const a=await sharedApp();for(const k of Object.keys(a.assets))a.assets[k]=1;return a;}

for(const command of ['/gold_and_other_precious_metals','/gold']) test(`${command} excludes Taam and Nahal while preserving precious metals`, async()=>{
  const a=await app();
  a.store.set('portfolio/latest.json',a.payload);
  await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text:command}},
    {'x-telegram-bot-api-secret-token':'fixture-webhook'});
  await completeFreshReport(a);
  const text=a.sends.map(x=>JSON.parse(x.options.body).text||'').join('\n');
  assert.ok(text.length>0);
  assert.doesNotMatch(text,/طعام|نهال/);
  for(const asset of ['طلا','عیار','گوهر','آلتون','امرالد','زرفام','شمش نقره 999']) assert.ok(text.includes(asset),asset);
});

test('/assets retains Taam and all 29 holdings including six manual balances', async()=>{
  const a=await app();
  a.store.set('portfolio/latest.json',a.payload);
  await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text:'/assets'}},
    {'x-telegram-bot-api-secret-token':'fixture-webhook'});
  await completeFreshReport(a);
  const text=a.sends.map(x=>JSON.parse(x.options.body).text||'').join('\n');
  assert.match(text,/طعام/);
  assert.match(text,/نهال/);
  assert.equal(a.ns.ASSETS.length,29);
  assert.deepEqual(JSON.parse(JSON.stringify(a.ns.MANUAL)),{'سکه تمام':3,'ربع سکه غیره':3,'ربع سکه بانکی':1,'آبشده (طلب)':1.37,'آبشده (شمش زربد)':20,'دلار':3030});
});


test('help advertises the renamed precious metals command', async()=>{
  const a=await app();
  await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text:'/help'}},
    {'x-telegram-bot-api-secret-token':'fixture-webhook'});
  const text=a.sends.map(x=>JSON.parse(x.options.body).text||'').join('\n');
  assert.match(text,/\/gold_and_other_precious_metals — gold and other precious metals/);
});

test('renamed command retains stale snapshot protection', async()=>{
  const a=await app();a.store.set('portfolio/latest.json',{...a.payload,updated_at:'2020-01-01T00:00:00Z'});
  await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text:'/gold_and_other_precious_metals'}},
    {'x-telegram-bot-api-secret-token':'fixture-webhook'});
  const text=a.sends.map(x=>JSON.parse(x.options.body).text||'').join('\n');
  assert.match(text,/در حال دریافت تازه‌ترین/);assert.equal(a.marketCalls.length,0);
  assert.doesNotMatch(text,/شمش نقره/);
});
