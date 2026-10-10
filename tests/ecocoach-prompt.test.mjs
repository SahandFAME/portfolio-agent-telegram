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
async function app({readError=false, quoteFailure=false, env={}}={}) {
  const store = new Map(), writes = [], sends = [], background = [];
  const tokenEnv = {PORTFOLIO_SYNC_SECRET:'fixture-primary',PORTFOLIO_SYNC_SECRET_AGENT:'fixture-secondary',
    TELEGRAM_WEBHOOK_SECRET:'fixture-webhook',TELEGRAM_BOT_TOKEN:'fixture-bot',TELEGRAM_ADMIN_USER_IDS:'1',...env};
  const quotes = async url => {
    url = String(url);
    if(url.startsWith('https://api.telegram.org/')) {
      return {ok:true, json:async()=>({ok:true}), text:async()=>''};
    }
    if(quoteFailure&&url.includes('coingecko')) throw new Error('synthetic unavailable crypto quote');
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



for(const command of ['/allocation','/refresh']) test(`${command} restores exact EcoCoach prompt and keeps pending price input`, async()=>{
  const a=await app();a.payload.assets['بلک راک']=15;
  a.store.set('portfolio/latest.json',a.payload);
  await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text:command}},
    {'x-telegram-bot-api-secret-token':'fixture-webhook'});
  assert.equal(a.sends.length,1);
  assert.equal(JSON.parse(a.sends[0].options.body).text,
    'برای تهیه گزارش، قیمت فعلی هر واحد صندوق بلک راک (EcoCoach) را به تومان ارسال کنید.\n\nتعداد: 15 واحد');
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'blackrock_price');
});

test('other missing prices still block totals and charts with an explanation', async()=>{
  const a=await app({quoteFailure:true});
  const report=await a.ns.allocationImageReply({...a.assets,...a.ns.MANUAL},null);
  assert.match(report.text,/گزارش ارزش‌گذاری کامل تهیه نشد/);
  assert.match(report.text,/قیمت ناموجود/);
  assert.match(report.text,/EcoCoach/);
  assert.equal(report.png,undefined);
  assert.equal(report.total,undefined);
});

test('missing quantities still prevent valuation rather than prompting for a price', async()=>{
  const a=await app();const q={...a.assets,...a.ns.MANUAL};delete q.BTC;
  const report=await a.ns.allocationImageReply(q,null);
  assert.match(report.text,/مقدار این دارایی‌ها/);
  assert.equal(report.png,undefined);
});

test('valid EcoCoach input still completes the existing image flow', async()=>{
  const a=await app();a.payload.assets['بلک راک']=15;
  a.store.set('portfolio/latest.json',a.payload);
  const message=text=>({message:{chat:{id:1,type:'private'},from:{id:1},text}});
  const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
  await a.request('POST',{},message('/allocation'),header);
  await a.request('POST',{},message('۸۵۰٬۰۰۰ تومان'),header);
  assert.ok(a.sends.some(x=>x.url.endsWith('/sendPhoto')));
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'none');
});
