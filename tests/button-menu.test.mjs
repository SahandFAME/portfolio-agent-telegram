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



const buttons=[['وضعیت','/status'],['دارایی‌ها','/assets'],['طلا و سایر فلزات گرانبها','/gold_and_other_precious_metals'],['رمزارز','/crypto'],['نقدینگی','/cash'],['Latest Allocation','/latest_allocation'],['راهنما','/help']];
const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const message=(text,id=1,type='private')=>({message:{chat:{id,type},from:{id},text}});

for(const [label,command] of buttons) test(`button ${label} runs ${command} with the same output`,async()=>{
  const a=await app();a.payload.assets['بلک راک']=15;a.store.set('portfolio/latest.json',a.payload);
  await a.request('POST',{},message(command),header);
  const expected=a.sends.map(x=>JSON.parse(x.options.body).text).join('\n');a.sends.length=0;
  await a.request('POST',{},message(label),header);
  const actual=a.sends.map(x=>JSON.parse(x.options.body).text).join('\n');
  const withoutRetrievalTime=text=>text.replace(/Prices retrieved: [^\n]+/g,'Prices retrieved: <fresh timestamp>');
  assert.equal(withoutRetrievalTime(actual),withoutRetrievalTime(expected));
  assert.ok(a.sends.length);
  for(const sent of a.sends){
    const keyboard=JSON.parse(sent.options.body).reply_markup;
    assert.equal(keyboard.is_persistent,true);assert.equal(keyboard.resize_keyboard,true);
    assert.deepEqual(keyboard.keyboard.flat().map(x=>x.text),buttons.map(x=>x[0]));
  }
});

for(const command of ['/start','/help','/menu']) test(`${command} exposes the persistent menu`,async()=>{
  const a=await app();await a.request('POST',{},message(command),header);
  const reply=JSON.parse(a.sends[0].options.body);
  assert.ok(reply.reply_markup.keyboard.length===4);assert.match(reply.text,/دکمه‌های منو/);
});

test('menu selections do not bypass private-chat or user access controls',async()=>{
  for(const [label] of buttons){
    const a=await app();await a.request('POST',{},message(label,2),header);
    const replies=a.sends.map(x=>JSON.parse(x.options.body)).filter(x=>x.chat_id===2);
    assert.equal(replies.length,1);const reply=replies[0];
    assert.match(reply.text,/private|access request/);assert.equal(reply.reply_markup,undefined);
    assert.doesNotMatch(reply.text,/دارایی‌های پرتفوی|Snapshot|تعداد: 15/);
    const b=await app();await b.request('POST',{},message(label,1,'group'),header);
    assert.equal(b.sends.length,0);
  }
});

test('valuation buttons retain stale quantity protection',async()=>{
  for(const label of ['طلا و سایر فلزات گرانبها','رمزارز','نقدینگی']){
    const a=await app();a.store.set('portfolio/latest.json',{...a.payload,updated_at:'2020-01-01T00:00:00Z'});
    await a.request('POST',{},message(label),header);
    assert.match(JSON.parse(a.sends[0].options.body).text,/Snapshot/);
  }
});

test('buttons work while waiting for EcoCoach and numeric input still sends a photo with a menu',async()=>{
  const a=await app();a.payload.assets['بلک راک']=15;a.store.set('portfolio/latest.json',a.payload);
  a.store.set('portfolio/pending-blackrock/1.json',{type:'blackrock_price'});
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'blackrock_price');
  await a.request('POST',{},message('دارایی‌ها'),header);
  assert.match(JSON.parse(a.sends.at(-1).options.body).text,/۲۹/);
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'blackrock_price');
  await a.request('POST',{},message('۸۵۰٬۰۰۰ تومان'),header);
  const photo=a.sends.find(x=>x.url.endsWith('/sendPhoto'));
  assert.ok(photo);
  assert.equal(JSON.parse(photo.options.body.get('reply_markup')).is_persistent,true);
  assert.equal(a.store.get('portfolio/pending-blackrock/1.json').type,'none');
});
