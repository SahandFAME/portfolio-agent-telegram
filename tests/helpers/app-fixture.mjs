import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { BlobPreconditionFailedError } from '@vercel/blob';

const source = await fs.readFile(new URL('../../api/telegram.js', import.meta.url), 'utf8');
// Evaluate the actual unmodified handler, injecting only external dependencies.
// Named exports below exist only inside the test VM, not in application code.
export async function app({readError=false, dispatchStatus=204, env={}, telegramReply=null,beforeWrite=null,beforeMarketFetch=null}={}) {
  const store = new Map(), writes = [], sends = [], background = [], dispatches=[], marketCalls=[];
  const tokenEnv = {PORTFOLIO_SYNC_SECRET:'fixture-primary',PORTFOLIO_SYNC_SECRET_AGENT:'fixture-secondary',
    GITHUB_ACTIONS_TOKEN:'fixture-actions',TELEGRAM_WEBHOOK_SECRET:'fixture-webhook',TELEGRAM_BOT_TOKEN:'fixture-bot',TELEGRAM_ADMIN_USER_IDS:'1',...env};
  const quotes = async url => {
    url = String(url);
    if(url.startsWith('https://api.telegram.org/')) {
      const call=sends.at(-1), method=url.split('/').at(-1);
      const result=telegramReply ? await telegramReply(call,sends.length) : null;
      const value=result||{ok:true,result:{message_id:sends.length}};
      return {ok:value.ok!==false,status:value.status||200,json:async()=>value};
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
    crypto:globalThis.crypto,AbortSignal,
    fetch:async(url,options)=>{
      if(String(url).startsWith('https://api.github.com/')){dispatches.push({url:String(url),options});return {status:dispatchStatus};}
      if(!String(url).startsWith('https://api.telegram.org/')){
        marketCalls.push(String(url));if(beforeMarketFetch)await beforeMarketFetch(url,store);
      }
      if(String(url).startsWith('https://api.telegram.org/')) sends.push({url:String(url),options});
      return quotes(url,options);
    }});
  const dependencies = {
    '@vercel/blob':{
      BlobPreconditionFailedError,
      get:async key => {
        if(typeof readError==='function'?readError(key):readError) throw new Error('fixture storage unavailable');
        if(!store.has(key)) return null;
        const text=JSON.stringify(store.get(key));
        return {blob:{etag:text},stream:new ReadableStream({start(c){c.enqueue(Buffer.from(text));c.close();}})};
      },
      put:async(key,value,options)=>{
        if(beforeWrite)await beforeWrite(key,value,options,store);
        if(options.ifMatch&&options.ifMatch!==JSON.stringify(store.get(key))){
          throw new BlobPreconditionFailedError();
        }
        if(options.allowOverwrite===false&&store.has(key))throw new Error('fixture blob already exists');
        writes.push({key,value:JSON.parse(value),options});store.set(key,JSON.parse(value));
      }
    },
    '@vercel/functions':{waitUntil:promise=>background.push(promise)},
    sharp:{default:sharp},'@resvg/resvg-js':{Resvg},path:{default:path}
  };
  const module = new vm.SourceTextModule(source + '\nexport {ASSETS,MANUAL,parseUserPrice,valueRial,quantitySnapshotStatus,getPrices,buildPortfolioSvg,allocationImageReply,sendTelegram,sendTelegramPhoto,portfolioTime,boldPortfolioTime,allocationReply};', {context});
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
  return {ns,store,writes,sends,request,payload,assets,dispatches,marketCalls};
}
