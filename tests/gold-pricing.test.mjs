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
async function app({readError=false, missingGold=false, env={}}={}) {
  const store = new Map(), writes = [], sends = [], background = [], marketRequests = [];
  const tokenEnv = {PORTFOLIO_SYNC_SECRET:'fixture-primary',PORTFOLIO_SYNC_SECRET_AGENT:'fixture-secondary',
    TELEGRAM_WEBHOOK_SECRET:'fixture-webhook',TELEGRAM_BOT_TOKEN:'fixture-bot',TELEGRAM_ADMIN_USER_IDS:'1',...env};
  const quotes = async url => {
    url = String(url);
    if(!url.startsWith('https://api.telegram.org/')) marketRequests.push(url);
    if(missingGold&&url.includes('/profile/geram18')) throw new Error('synthetic missing 18K quote');
    if(url.startsWith('https://api.telegram.org/')) {
      return {ok:true, json:async()=>({ok:true}), text:async()=>''};
    }
    if(url.includes('coingecko')) return {ok:true,json:async()=>Object.fromEntries(
      ['bitcoin','ethereum','tether','chainlink','cardano','solana','ondo-finance'].map(k=>[k,{usd:2}]))};
    let text = 'آخرین قیمت 1,200,000';
    if(url.includes('/ime/')) text = 'SilverBar 999.9 1,200,000';
    if(url.includes('/profile/')) {
      const price = url.includes('price_dollar_rl') ? 1000000 : url.includes('geram18') ? 265000000 :
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
  const module = new vm.SourceTextModule(source + '\nexport {ASSETS,MANUAL,parseUserPrice,valueRial,quantitySnapshotStatus,getPrices,buildPortfolioSvg,allocationImageReply,sendTelegram,unitPriceDisplay};', {context});
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
  return {ns,store,writes,sends,request,payload,assets,marketRequests};
}



test('both 18K gram holdings use identical direct quotes without mithqal conversion', async()=>{
  const a=await app();const {prices}=await a.ns.getPrices();
  for(const asset of ['آبشده (طلب)','آبشده (شمش زربد)']){
    assert.equal(prices[asset].priceRial,265000000);
    assert.equal(prices[asset].unit,'IRR/g');
    assert.equal(a.ns.unitPriceDisplay(asset,prices[asset]),'26,500,000 toman');
  }
  assert.equal(a.ns.valueRial('آبشده (طلب)',1.37,prices['آبشده (طلب)'],1000000),363050000);
  assert.equal(a.ns.valueRial('آبشده (شمش زربد)',20,prices['آبشده (شمش زربد)'],1000000),5300000000);
  assert.equal(prices['ربع سکه غیره'].priceRial,265000000*2.03325);
  assert.equal(a.marketRequests.filter(x=>x.includes('/profile/geram18')).length,1);
  assert.equal(a.marketRequests.filter(x=>x.includes('gold_futures')).length,0);
  assert.notEqual(prices['آبشده (طلب)'],prices['آبشده (شمش زربد)']);
});

test('the image table shows the same 18K unit price for both gold holdings',async()=>{
  const a=await app();const {prices}=await a.ns.getPrices();
  const q={...a.assets,...a.ns.MANUAL};
  prices['بلک راک']={priceRial:8500000,source:'User input'};
  const values=Object.fromEntries([...a.ns.ASSETS].map(asset=>[asset,a.ns.valueRial(asset,q[asset],prices[asset],prices['دلار'].priceRial)]));
  const total=Object.values(values).reduce((sum,value)=>sum+value,0);
  const svg=a.ns.buildPortfolioSvg(q,values,total,prices,prices['دلار'].priceRial);
  assert.ok(svg.includes('Gold Receivable'));
  assert.ok(svg.includes('Zarbed Gold Bar'));
  assert.equal(svg.split('26,500,000').length-1,2);
  const report=await a.ns.allocationImageReply(q,8500000);
  assert.ok(report.png.length>1000);
});

test('missing 18K price blocks the image rather than using a futures or fixed price',async()=>{
  const a=await app({missingGold:true});const {prices,errors}=await a.ns.getPrices();
  for(const asset of ['آبشده (طلب)','آبشده (شمش زربد)']){
    assert.equal(prices[asset],undefined);
    assert.ok(errors[asset]);
  }
  const report=await a.ns.allocationImageReply({...a.assets,...a.ns.MANUAL},8500000);
  assert.equal(report.png,undefined);
  assert.equal(report.total,undefined);
  assert.match(report.text,/قیمت ناموجود/);
});
