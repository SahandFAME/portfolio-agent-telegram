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


test('/gold excludes Taam and Nahal while preserving gold funds and silver certificates', async()=>{
  const a=await app();
  a.store.set('portfolio/latest.json',a.payload);
  await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text:'/gold'}},
    {'x-telegram-bot-api-secret-token':'fixture-webhook'});
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
  const text=a.sends.map(x=>JSON.parse(x.options.body).text||'').join('\n');
  assert.match(text,/طعام/);
  assert.match(text,/نهال/);
  assert.equal(a.ns.ASSETS.length,29);
  assert.deepEqual(JSON.parse(JSON.stringify(a.ns.MANUAL)),{'سکه تمام':3,'ربع سکه غیره':3,'ربع سکه بانکی':1,'آبشده (طلب)':1.37,'آبشده (شمش زربد)':20,'دلار':3030});
});
