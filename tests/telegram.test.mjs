import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';

const source = await fs.readFile(new URL('../api/telegram.js', import.meta.url), 'utf8');
// Evaluate the actual unmodified handler, injecting only external dependencies.
// Named exports below exist only inside the test VM, not in application code.
async function app({readError=false, env={}}={}) {
  const store = new Map(), writes = [], sends = [], background = [];
  const tokenEnv = {PORTFOLIO_SYNC_SECRET:'fixture-primary',PORTFOLIO_SYNC_SECRET_AGENT:'fixture-secondary',
    TELEGRAM_WEBHOOK_SECRET:'fixture-webhook',TELEGRAM_BOT_TOKEN:'fixture-bot',TELEGRAM_ADMIN_USER_IDS:'1',...env};
  const quotes = async url => {
    url = String(url);
    if(url.startsWith('https://api.telegram.org/')) {
      return {ok:true, json:async()=>({ok:true}), text:async()=>''};
    }
    if(url.includes('coingecko')) return {ok:true,json:async()=>Object.fromEntries(
      ['bitcoin','ethereum','tether','chainlink','cardano','solana','ondo-finance'].map(k=>[k,{usd:2}]))};
    let text = 'آخرین قیمت 1,200,000';
    if(url.includes('/ime/')) text = 'SilverBar 999.9 1,200,000';
    if(url.includes('/profile/')) {
      const price = url.includes('price_dollar_rl') ? 1000000 : url.includes('geram18') ? 200000000 :
        url.includes('/rob') ? 1000000000 : url.includes('gold_futures') ? 1000000000 : 2000000000;
      text = 'نرخ فعلی ' + price;
    }
    return {ok:true,text:async()=>text};
  };
  const context = vm.createContext({console:{info(){},warn(){},error(){}},Buffer,Date,Number,
    URL,FormData,Blob,TextEncoder,ReadableStream,process:{env:tokenEnv,cwd:()=>process.cwd()},
    fetch:async(url,options)=>{
      if(String(url).startsWith('https://api.telegram.org/')) sends.push({url:String(url),options});
      return quotes(url,options);
    }});
  const dependencies = {
    '@vercel/blob':{
      get:async key => {
        if(readError) throw new Error('fixture storage unavailable');
        if(!store.has(key)) return null;
        return {stream:new ReadableStream({start(c){c.enqueue(Buffer.from(JSON.stringify(store.get(key))));c.close();}})};
      },
      put:async(key,value)=>{writes.push({key,value:JSON.parse(value)});store.set(key,JSON.parse(value));}
    },
    '@vercel/functions':{waitUntil:promise=>background.push(promise)},
    sharp:{default:sharp},'@resvg/resvg-js':{Resvg},path:{default:path}
  };
  const module = new vm.SourceTextModule(source + '\nexport {ASSETS,MANUAL,parseUserPrice,valueRial,quantitySnapshotStatus,getPrices,buildPortfolioSvg,allocationImageReply,sendTelegram};', {context});
  await module.link(async specifier => {
    const exports = dependencies[specifier];
    assert.ok(exports, `unexpected dependency ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exports),function(){
      for(const [key,value] of Object.entries(exports)) this.setExport(key,value);
    },{context});
  });
  await module.evaluate();
  const ns = module.namespace;
  const assets = Object.fromEntries([...ns.ASSETS].filter(x=>!(x in ns.MANUAL)).map(x=>[x,0]));
  const payload = {version:'synthetic fixture',updated_at:new Date().toISOString(),
    workbook_updated_at:'2026-01-01T00:00:00Z',assets};
  async function request(method, query={}, body={}, headers={}) {
    const res = {status(code){this.code=code;return this;},json(data){this.data=data;},send(data){this.data=data;}};
    await ns.default({method,query,body,headers},res);
    await Promise.all(background.splice(0));
    return res;
  }
  return {ns,store,writes,sends,request,payload,assets};
}

test('29 assets retain exactly six independent manual holdings',async()=>{
  const {ns,assets}=await app();
  assert.equal(ns.ASSETS.length,29);assert.equal(Object.keys(assets).length,23);
  assert.deepEqual(JSON.parse(JSON.stringify(ns.MANUAL)),{'سکه تمام':3,'ربع سکه غیره':3,'ربع سکه بانکی':1,'آبشده (طلب)':1.37,'آبشده (شمش زربد)':20,'دلار':3030});
});
test('health is distinct from authenticated cache readback',async()=>{
  const a=await app();
  assert.equal((await a.request('GET')).code,200);
  assert.equal((await a.request('GET',{data:'portfolio'})).code,401);
  assert.equal((await a.request('PUT')).code,405);
});
test('wrong sync credential is rejected without storage writes',async()=>{
  const a=await app();assert.equal((await a.request('POST',{sync:'portfolio'},a.payload,{'x-portfolio-sync-secret':'wrong'})).code,401);
  assert.equal(a.writes.length,0);
});
for(const credential of ['fixture-primary','fixture-secondary']) {
  test(`accepted ${credential} stores 23 valid zero quantities and exact readback`,async()=>{
    const a=await app(),headers={'x-portfolio-sync-secret':credential};
    assert.equal((await a.request('POST',{sync:'portfolio'},a.payload,headers)).code,200);
    const result=await a.request('GET',{data:'portfolio'},{},headers);
    assert.equal(result.code,200);assert.deepEqual(JSON.parse(JSON.stringify(result.data.snapshot)),a.payload);
    assert.equal(Object.keys(a.writes[0].value.assets).length,23);
  });
}
for(const value of [-1,NaN,Infinity]) test(`reject invalid quantity ${value}`,async()=>{
  const a=await app();a.payload.assets.BTC=value;
  assert.equal((await a.request('POST',{sync:'portfolio'},a.payload,{'x-portfolio-sync-secret':'fixture-primary'})).code,400);
  assert.equal(a.writes.length,0);
});
test('missing assets and 29-asset sync are rejected',async()=>{
  const a=await app();
  assert.equal((await a.request('POST',{sync:'portfolio'},{...a.payload,assets:{}},{'x-portfolio-sync-secret':'fixture-primary'})).code,400);
  assert.equal((await a.request('POST',{sync:'portfolio'},{...a.payload,assets:{...a.assets,...a.ns.MANUAL}},{'x-portfolio-sync-secret':'fixture-primary'})).code,400);
  assert.equal(a.writes.length,0);
});
test('older workbook rejected, unchanged workbook may refresh sync clock',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',{...a.payload,workbook_updated_at:'2026-01-02T00:00:00Z'});
  assert.equal((await a.request('POST',{sync:'portfolio'},a.payload,{'x-portfolio-sync-secret':'fixture-primary'})).code,409);
  a.payload.workbook_updated_at='2026-01-02T00:00:00Z';
  assert.equal((await a.request('POST',{sync:'portfolio'},a.payload,{'x-portfolio-sync-secret':'fixture-primary'})).code,200);
});
test('fresh sync of old unchanged workbook is fresh; missing, stale or future sync is blocked',async()=>{
  const {ns}=await app();
  assert.equal(ns.quantitySnapshotStatus({updated_at:new Date().toISOString(),workbook_updated_at:'2020-01-01T00:00:00Z'}).stale,false);
  for(const snapshot of [null,{updated_at:'invalid'},{updated_at:'2000-01-01T00:00:00Z'},{updated_at:'2099-01-01T00:00:00Z'}]) assert.equal(ns.quantitySnapshotStatus(snapshot).stale,true);
});
test('currency, grams, coins and shares use correct supplied unit price',async()=>{
  const {ns}=await app();
  assert.equal(ns.valueRial('BTC',0.5,{priceUsd:100},1000000),50000000);
  assert.equal(ns.valueRial('دلار',3030,{priceRial:1000000},1000000),3030000000);
  assert.equal(ns.valueRial('آبشده (طلب)',1.37,{priceRial:1000},1000000),1370);
  assert.equal(ns.valueRial('سکه تمام',3,{priceRial:1000},1000000),3000);
  assert.equal(ns.valueRial('فملی',2,{priceRial:1000},1000000),2000);
});
test('Persian EcoCoach input preserves rial/toman conversion and rejects invalid price',async()=>{
  const {ns}=await app();
  assert.equal(ns.parseUserPrice('۸۵۰٬۰۰۰ تومان'),8500000);
  assert.equal(ns.parseUserPrice('۸۵۰٬۰۰۰ ریال'),850000);
  for(const value of ['no price','0','-1']) assert.equal(ns.parseUserPrice(value),null);
});
test('unauthenticated webhook rejected and group message ignored',async()=>{
  const a=await app();
  assert.equal((await a.request('POST')).code,401);
  assert.equal((await a.request('POST',{}, {message:{chat:{id:2,type:'group'},from:{id:2},text:'/assets'}}, {'x-telegram-bot-api-secret-token':'fixture-webhook'})).code,200);
  assert.equal(a.sends.length,0);
});
test('missing webhook secret fails closed',async()=>{
  const a=await app({env:{TELEGRAM_WEBHOOK_SECRET:''}});
  assert.equal((await a.request('POST')).code,503);
  assert.equal(a.sends.length,0);
});
test('unapproved private user cannot retrieve holdings',async()=>{
  const a=await app();
  await a.request('POST',{}, {message:{chat:{id:2,type:'private'},from:{id:2},text:'/assets'}}, {'x-telegram-bot-api-secret-token':'fixture-webhook'});
  assert.equal(a.sends.length,1);
  assert.match(JSON.parse(a.sends[0].options.body).text,/private/);
  assert.equal(a.writes.length,0);
});
test('all valuation commands refuse stale snapshot before market calls',async()=>{
  for(const command of ['/gold','/crypto','/cash','/allocation','/refresh']) {
    const a=await app();a.store.set('portfolio/latest.json',{...a.payload,updated_at:'2020-01-01T00:00:00Z'});
    await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text:command}}, {'x-telegram-bot-api-secret-token':'fixture-webhook'});
    assert.equal(a.sends.length,1);assert.match(JSON.parse(a.sends[0].options.body).text,/Snapshot/);
  }
});
test('missing EcoCoach price or quantity omits total and chart',async()=>{
  const a=await app();const quantities={...a.assets,...a.ns.MANUAL};
  const report=await a.ns.allocationImageReply(quantities,null);
  assert.equal(report.png,undefined);assert.match(report.text,/EcoCoach/);
  delete quantities.BTC;
  assert.equal((await a.ns.allocationImageReply(quantities,100)).png,undefined);
});
test('complete synthetic portfolio renders PNG with Persian font',async()=>{
  const a=await app();const quantities={...Object.fromEntries(Object.keys(a.assets).map(x=>[x,1])),...a.ns.MANUAL};
  const report=await a.ns.allocationImageReply(quantities,100);
  assert.ok(report.total>0);assert.ok(report.png.length>1000);
  const info=await sharp(report.png).metadata();assert.equal(info.format,'png');assert.ok(info.width>1000);
});

// Regressions reproduced against the original handler and repaired locally.
// These checks do not establish that the deployed production bot is repaired.
test('sync must reject null assets with HTTP 400', async()=>{
  const a=await app();a.payload.assets=null;
  assert.equal((await a.request('POST',{sync:'portfolio'},a.payload,{'x-portfolio-sync-secret':'fixture-primary'})).code,400);
});
test('sync must reject boolean quantities', async()=>{
  const a=await app();a.payload.assets.BTC=true;
  assert.equal((await a.request('POST',{sync:'portfolio'},a.payload,{'x-portfolio-sync-secret':'fixture-primary'})).code,400);
});
test('sync must not overwrite after storage read error', async()=>{
  const a=await app({readError:true});
  assert.notEqual((await a.request('POST',{sync:'portfolio'},a.payload,{'x-portfolio-sync-secret':'fixture-primary'})).code,200);
  assert.equal(a.writes.length,0);
});
test('cached melted gold quote must be converted to grams once for each holding', async()=>{
  const {ns}=await app();const {prices}=await ns.getPrices();
  assert.equal(prices['آبشده (طلب)'].priceRial,prices['آبشده (شمش زربد)'].priceRial);
});
test('long Telegram reports must be split on actual newline boundaries', async()=>{
  const a=await app();await a.ns.sendTelegram(1,Array.from({length:200},()=> 'x'.repeat(30)).join('\n'));
  assert.ok(a.sends.length>1);
  for(const send of a.sends) assert.ok(JSON.parse(send.options.body).text.length<=4096);
});
test('single long plain-text line is split below the Telegram limit',async()=>{
  const a=await app();await a.ns.sendTelegram(1,'x'.repeat(10000));
  assert.ok(a.sends.length>1);
  for(const send of a.sends) assert.ok(JSON.parse(send.options.body).text.length<=4096);
});
test('long preformatted report retains prefix, table and suffix without throwing',async()=>{
  const a=await app();
  const body=Array.from({length:200},()=> 'row '.repeat(10)).join('\n');
  await a.ns.sendTelegram(1,'Report heading\n<pre>'+body+'</pre>\nReport footer');
  const messages=a.sends.map(x=>JSON.parse(x.options.body).text);
  assert.ok(messages.length>2);
  assert.ok(messages[0].startsWith('Report heading'));
  assert.equal(messages.at(-1),'Report footer');
  for(const message of messages) assert.ok(message.length<=4096);
});
