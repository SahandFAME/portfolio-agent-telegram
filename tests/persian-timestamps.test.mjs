import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/app-fixture.mjs';

const ACCESS_POLICY_STARTED_AT=new Date().toISOString();

const headers={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const messages=a=>a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));
async function command(a,text){
  await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text}},headers);
  return messages(a).at(-1);
}
async function click(a,data){
  await a.request('POST',{}, {callback_query:{id:'fixture',data,from:{id:1},message:{chat:{id:1,type:'private'}}}},headers);
  return messages(a).at(-1);
}
const timePattern=/[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2} • [۰-۹]{2}:[۰-۹]{2}:[۰-۹]{2} \(تهران\)/;
const boldPattern=new RegExp('<b>'+timePattern.source+'</b>');

test('Solar Hijri formatter uses Tehran time at midnight rollover and Nowruz',async()=>{
  const {ns}=await app();
  for(const [utc,local] of [
    ['2026-10-11T03:00:10Z','۱۴۰۵/۰۷/۱۹ • ۰۶:۳۰:۱۰ (تهران)'],
    ['2026-10-10T21:15:00Z','۱۴۰۵/۰۷/۱۹ • ۰۰:۴۵:۰۰ (تهران)'],
    ['2026-03-20T20:29:59Z','۱۴۰۴/۱۲/۲۹ • ۲۳:۵۹:۵۹ (تهران)'],
    ['2026-03-20T20:30:00Z','۱۴۰۵/۰۱/۰۱ • ۰۰:۰۰:۰۰ (تهران)'],
    ['2026-07-01T00:00:00Z','۱۴۰۵/۰۴/۱۰ • ۰۳:۳۰:۰۰ (تهران)']
  ]){
    assert.equal(ns.portfolioTime(utc),local);
    assert.equal(ns.boldPortfolioTime(utc),'<b>'+local+'</b>');
  }
  for(const invalid of [undefined,null,'','not-a-date','<i>injected</i>']){
    assert.equal(ns.boldPortfolioTime(invalid),'<b>نامشخص</b>');
  }
});

test('status, assets and stale warnings display bold Persian times without changing UTC storage',async()=>{
  const a=await app();const snapshot={...a.payload,updated_at:'2026-10-11T03:00:10Z',workbook_updated_at:'2026-10-10T21:15:00Z'};
  a.store.set('portfolio/latest.json',snapshot);
  const before=JSON.stringify(snapshot);
  const status=await command(a,'/status');
  assert.equal(status.parse_mode,'HTML');
  assert.ok(status.text.includes('<b>۱۴۰۵/۰۷/۱۹ • ۰۶:۳۰:۱۰ (تهران)</b>'));
  assert.ok(status.text.includes('<b>۱۴۰۵/۰۷/۱۹ • ۰۰:۴۵:۰۰ (تهران)</b>'));
  const assets=await command(a,'/assets');assert.match(assets.text,boldPattern);
  assert.doesNotMatch(status.text+assets.text,/2026-10|T03:00/);
  const stale=a.ns.quantitySnapshotStatus({...snapshot,updated_at:'2026-01-01T00:00:00Z'});
  assert.equal(stale.stale,true);assert.ok(stale.message.includes('<b>۱۴۰۴/۱۰/۱۱ • ۰۳:۳۰:۰۰ (تهران)</b>'));
  assert.equal(JSON.stringify(a.store.get('portfolio/latest.json')),before);
});

test('gold, crypto and dollar price retrieval timestamps are bold Persian Tehran times',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',a.payload);
  for(const text of ['/gold','/crypto','/cash_dollar']){
    const reply=await command(a,text);assert.equal(reply.parse_mode,'HTML');
    assert.match(reply.text,new RegExp('قیمت‌های بازار: '+boldPattern.source));
    assert.doesNotMatch(reply.text,/\d{4}-\d{2}-\d{2}T/);
  }
});

test('admin status and audit enable HTML for bold times while escaping audit identifiers',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',{...a.payload,updated_at:'2026-10-11T03:00:10Z'});
  a.store.set('portfolio/access-control.json',{accessPolicy:{version:1,activated_at:ACCESS_POLICY_STARTED_AT},approved:['2'],pending:{},delegatedAdmins:[],users:{},audit:[
    {at:'2026-03-20T20:30:00Z',action:'approve',target_id:'<b>2</b>',actor_id:'1&2'}
  ]});
  const status=await click(a,'admin:status');assert.equal(status.parse_mode,'HTML');assert.match(status.text,boldPattern);
  const audit=await click(a,'admin:audit');assert.equal(audit.parse_mode,'HTML');
  assert.ok(audit.text.includes('<b>۱۴۰۵/۰۱/۰۱ • ۰۰:۰۰:۰۰ (تهران)</b>'));
  assert.ok(audit.text.includes('&lt;b&gt;2&lt;/b&gt;'));assert.ok(audit.text.includes('1&amp;2'));
  assert.doesNotMatch(audit.text,/2026-|<b>2<\/b>/);
  const missing=await app();const reply=await click(missing,'admin:status');
  assert.equal((reply.text.match(/<b>نامشخص<\/b>/g)||[]).length,2);
});

test('allocation image uses one bold Persian Tehran price time in its header and summary',async()=>{
  const a=await app();const {prices}=await a.ns.getPrices();
  const q={...a.assets,...a.ns.MANUAL};prices['بلک راک']={priceRial:100000,source:'User input'};
  const values=Object.fromEntries([...a.ns.ASSETS].map(asset=>[asset,a.ns.valueRial(asset,q[asset],prices[asset],prices['دلار'].priceRial)]));
  const total=Object.values(values).reduce((sum,value)=>sum+value,0);
  const svg=a.ns.buildPortfolioSvg(q,values,total,prices,prices['دلار'].priceRial);
  const times=[...svg.matchAll(/<text[^>]*>([^<]*\(تهران\))<\/text>/g)];
  assert.equal(times.length,2);
  for(const stamp of times){assert.match(stamp[0],/font-weight="700"/);assert.match(stamp[1],timePattern);}
  assert.equal(times[0][1].replace('قیمت‌های زنده بازار • ',''),times[1][1]);
  assert.doesNotMatch(svg,/\d{1,2}\/\d{1,2}\/2026|\d{4}-\d{2}-\d{2}T/);
  const report=await a.ns.allocationImageReply(q,100000);assert.equal(report.total,total);assert.ok(report.png.length>1000);
  const text=await a.ns.allocationReply(q,100000);assert.match(text,new RegExp('<b>Retrieved:</b> '+boldPattern.source));
});
