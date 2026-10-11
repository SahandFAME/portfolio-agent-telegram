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
async function app({readError=false, dispatchStatus=204, env={}}={}) {
  const store = new Map(), writes = [], sends = [], background = [], dispatches=[], marketCalls=[];
  const tokenEnv = {PORTFOLIO_SYNC_SECRET:'fixture-primary',PORTFOLIO_SYNC_SECRET_AGENT:'fixture-secondary',
    GITHUB_ACTIONS_TOKEN:'fixture-actions',TELEGRAM_WEBHOOK_SECRET:'fixture-webhook',TELEGRAM_BOT_TOKEN:'fixture-bot',TELEGRAM_ADMIN_USER_IDS:'1',...env};
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
    crypto:globalThis.crypto,AbortSignal,
    fetch:async(url,options)=>{
      if(String(url).startsWith('https://api.github.com/')){dispatches.push({url:String(url),options});return {status:dispatchStatus};}
      if(!String(url).startsWith('https://api.telegram.org/'))marketCalls.push(String(url));
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
  return {ns,store,writes,sends,request,payload,assets,dispatches,marketCalls};
}



const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const callbackHeader={'x-portfolio-sync-secret':'fixture-secondary'};
const message=(text,id=1)=>({message:{chat:{id,type:'private'},from:{id},text}});
function dispatchedId(a){return JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;}
async function complete(a,id,{mismatch=false,ok=true}={}){
  const snapshot={...a.payload,updated_at:new Date().toISOString(),assets:{...a.assets,'بلک راک':15}};
  a.store.set('portfolio/latest.json',snapshot);
  return a.request('POST',{complete:'latest-allocation'},
    {request_id:id,ok,snapshot_updated_at:mismatch?'different':snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},callbackHeader);
}

for(const command of ['/latest_allocation','Latest Allocation','/allocation','/refresh','تخصیص دارایی','به‌روزرسانی'])
  test(`${command} requires a fresh OneDrive workflow before any market fetch`,async()=>{
    const a=await app();await a.request('POST',{},message(command),header);
    assert.equal(a.dispatches.length,1);assert.equal(a.marketCalls.length,0);
    const payload=JSON.parse(a.dispatches[0].options.body);
    assert.equal(payload.ref,'main');assert.match(payload.inputs.request_id,/^[a-f0-9-]{36}$/);
    assert.equal(Object.keys(payload.inputs).length,2);
    assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
  });

test('missing dispatch credential fails closed with no cached allocation',async()=>{
  const a=await app({env:{GITHUB_ACTIONS_TOKEN:''}});a.store.set('portfolio/latest.json',a.payload);
  await a.request('POST',{},message('/latest_allocation'),header);
  assert.equal(a.dispatches.length,0);assert.equal(a.marketCalls.length,0);
  assert.match(JSON.parse(a.sends[0].options.body).text,/پیکربندی نشده/);
});

test('dispatch failure reports failure and releases the queued request',async()=>{
  const a=await app({dispatchStatus:403});await a.request('POST',{},message('/latest_allocation'),header);
  const id=dispatchedId(a);
  assert.equal(a.store.get('portfolio/latest-allocation/requests/'+id+'.json').status,'failed');
  assert.match(JSON.parse(a.sends[0].options.body).text,/ناموفق/);
  assert.equal(a.marketCalls.length,0);
});

test('repeated taps reuse the queued request without dispatching duplicate jobs',async()=>{
  const a=await app();await a.request('POST',{},message('/latest_allocation'),header);
  await a.request('POST',{},message('Latest Allocation'),header);assert.equal(a.dispatches.length,1);
});

test('only verified callback resumes EcoCoach prompt; price input refreshes quantities again and renders',async()=>{
  const a=await app();await a.request('POST',{},message('/latest_allocation'),header);const id=dispatchedId(a);
  const result=await complete(a,id);assert.equal(result.code,200);
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'latest_blackrock_price');
  assert.equal(JSON.parse(a.sends.at(-1).options.body).text,'برای تهیه گزارش، قیمت فعلی هر واحد صندوق بلک راک (EcoCoach) را به تومان ارسال کنید.\n\nتعداد: 15 واحد');
  const calls=a.marketCalls.length;
  await a.request('POST',{},message('۸۵۰٬۰۰۰ تومان'),header);
  assert.equal(a.dispatches.length,2);assert.equal(a.marketCalls.length,calls);
  const second=dispatchedId(a);assert.notEqual(second,id);
  await complete(a,second);
  assert.ok(a.sends.some(x=>x.url.endsWith('/sendPhoto')));
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'none');
});

test('callback authentication and request correlation are required',async()=>{
  const a=await app();
  assert.equal((await a.request('POST',{complete:'latest-allocation'},{request_id:'x',ok:true},{})).code,401);
  assert.equal((await a.request('POST',{complete:'latest-allocation'},{request_id:'x',ok:true},callbackHeader)).code,400);
  assert.equal((await a.request('POST',{complete:'latest-allocation'},{request_id:'00000000-0000-4000-8000-000000000001',ok:true},callbackHeader)).code,404);
  assert.equal(a.marketCalls.length,0);assert.equal(a.sends.length,0);
});

for(const scenario of ['failure','mismatch','expired','revoked'])test(`${scenario} never renders a cached allocation`,async()=>{
  const a=await app();await a.request('POST',{},message('/latest_allocation'),header);const id=dispatchedId(a);
  if(scenario==='expired')a.store.get('portfolio/latest-allocation/requests/'+id+'.json').requested_at='2020-01-01T00:00:00Z';
  if(scenario==='revoked'){
    a.store.get('portfolio/latest-allocation/requests/'+id+'.json').user_id='2';
  }
  const sent=a.sends.length;
  await complete(a,id,{ok:scenario!=='failure',mismatch:scenario==='mismatch'});
  assert.equal(a.marketCalls.length,0);assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
  if(scenario==='revoked')assert.equal(a.sends.length,sent);
});

test('duplicate callback does not send a second prompt or fetch quotes again',async()=>{
  const a=await app();await a.request('POST',{},message('/latest_allocation'),header);const id=dispatchedId(a);
  await complete(a,id);const sent=a.sends.length,calls=a.marketCalls.length;
  const result=await complete(a,id);assert.equal(result.data.ignored,true);
  assert.equal(a.sends.length,sent);assert.equal(a.marketCalls.length,calls);
});

test('unapproved users cannot dispatch a live quantity job',async()=>{
  const a=await app();await a.request('POST',{},message('/latest_allocation',2),header);
  assert.equal(a.dispatches.length,0);assert.equal(a.marketCalls.length,0);
});

test('strict synchronization and unavailable prior storage fail closed',async()=>{
  const a=await app();for(const value of [true,'1',null]){
    assert.equal((await a.request('POST',{sync:'portfolio'},{...a.payload,assets:{...a.assets,BTC:value}},callbackHeader)).code,400);
  }
  assert.equal((await a.request('POST',{sync:'portfolio'},{...a.payload,assets:null},callbackHeader)).code,400);
  const b=await app({readError:true});
  assert.equal((await b.request('POST',{sync:'portfolio'},b.payload,callbackHeader)).code,500);
});


test('an older EcoCoach prompt cannot render cached holdings during the fresh sync',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',a.payload);
  a.store.set('portfolio/pending-blackrock/1.json',{type:'blackrock_price'});
  await a.request('POST',{},message('/latest_allocation'),header);
  await a.request('POST',{},message('850000'),header);
  assert.equal(a.marketCalls.length,0);assert.equal(a.dispatches.length,1);
  assert.match(JSON.parse(a.sends.at(-1).options.body).text,/منتظر درخواست قیمت/);
});
