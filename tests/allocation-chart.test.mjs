import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {app} from './helpers/app-fixture.mjs';

const ACCESS_POLICY_STARTED_AT=new Date().toISOString();

const headers={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const auth={'x-portfolio-sync-secret':'fixture-secondary'};
const messages=a=>a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));
const message=(text,id=1)=>({message:{chat:{id,type:'private'},from:{id},text}});
const jobId=a=>JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
async function complete(a,id=jobId(a),{ok=true,mismatch=false}={}){
  const snapshot={...a.payload,assets:{...a.assets,'بلک راک':15},updated_at:new Date().toISOString()};
  a.store.set('portfolio/latest.json',snapshot);
  return a.request('POST',{complete:'latest-allocation'},{request_id:id,ok,
    snapshot_updated_at:mismatch?'different':snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},auth);
}

test('chart button and slash command independently refresh quantities before quotes and retain chart after EcoCoach input',async()=>{
  for(const command of ['نمودار ترکیب دارایی','/allocation_chart']){
    const a=await app();a.store.set('portfolio/latest.json',{...a.payload,updated_at:'2020-01-01T00:00:00Z'});
    await a.request('POST',{},message(command),headers);
    assert.equal(a.dispatches.length,1);assert.equal(a.marketCalls.length,0);
    const first=jobId(a);assert.equal(a.store.get('portfolio/latest-allocation/requests/'+first+'.json').report_format,'chart');
    await complete(a);assert.match(messages(a).at(-1).text,/قیمت فعلی هر واحد صندوق بلک/);
    assert.equal(a.store.get('portfolio/pending-blackrock/1.json').report_format,'chart');
    const quotes=a.marketCalls.length;await a.request('POST',{},message('۸۵۰۰۰۰ تومان'),headers);
    assert.equal(a.dispatches.length,2);assert.equal(a.marketCalls.length,quotes);
    await complete(a);const photos=a.sends.filter(x=>x.url.endsWith('/sendPhoto'));assert.equal(photos.length,1);
    assert.match(photos[0].options.body.get('caption'),/^نمودار ترکیب دارایی/);
    const metadata=await sharp(Buffer.from(await photos[0].options.body.get('photo').arrayBuffer())).metadata();
    assert.equal(metadata.width,1600);assert.equal(metadata.height,1160);
    assert.equal(messages(a).some(x=>x.text.includes('گزارش تفصیلی')),false);
  }
});

test('3D chart slices and Persian labels match computed percentages, including zero groups',async()=>{
  const a=await app();const vals={'طلا':40,'شمش نقره 999':5,'نهال':5,'طعام':10,'فملی':10,'BTC':10,Tether:10,'دلار':10};
  for(const asset of Object.keys(vals))vals[asset]*=1e6;
  const report={vals,total:100e6,priceTime:'2026-10-11T09:00:00Z'};
  const svg=a.ns.buildAllocationPieSvg(report,{updated_at:'2026-10-11T08:59:00Z'});
  assert.match(svg,/data-layer="side"/);assert.equal((svg.match(/data-layer="top"/g)||[]).length,6);
  const groups=a.ns.allocationGroups(vals,100e6);
  for(const group of groups){
    assert.ok(svg.includes('data-category="'+group.category+'" data-percentage="'+group.percentage+'"'));
    assert.ok(svg.includes('>'+group.label+'</text>'));
    assert.ok(svg.includes('>'+group.percentage.toLocaleString('fa-IR',{minimumFractionDigits:2,maximumFractionDigits:2})+'٪</text>'));
  }
  assert.ok(svg.includes('۱۴۰۵/۰۷/۱۹ • ۱۲:۳۰:۰۰ (تهران)'));assert.ok(svg.includes('۱۴۰۵/۰۷/۱۹ • ۱۲:۲۹:۰۰ (تهران)'));
  assert.equal(groups.find(x=>x.category==='سهام و صندوق').percentage,25);
  const one=a.ns.buildAllocationPieSvg({...report,vals:{'طلا':100e6}});
  assert.equal((one.match(/data-layer="top"/g)||[]).length,1);
  assert.ok(one.includes('data-percentage="100"'));assert.equal((one.match(/>۰٫۰۰٪<\/text>/g)||[]).length,5);
  const png=a.ns.renderAllocationSvg(one);assert.ok(png.length>1000);
  for(const invalid of [{...report,total:0},{...report,total:99e6},{...report,vals:{'طلا':-1}},{...report,vals:{BTC:NaN}}])
    assert.throws(()=>a.ns.buildAllocationPieSvg(invalid),/invalid_allocation_chart/);
});

test('chart failures, expired callbacks and changed snapshots cannot render cached values',async()=>{
  for(const scenario of ['failure','expired','mismatch']){
    const a=await app();await a.request('POST',{},message('/allocation_chart'),headers);
    if(scenario==='expired')a.store.get('portfolio/latest-allocation/requests/'+jobId(a)+'.json').requested_at='2020-01-01T00:00:00Z';
    await complete(a,jobId(a),{ok:scenario!=='failure',mismatch:scenario==='mismatch'});
    assert.equal(a.marketCalls.length,0);assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
  }
});

test('unapproved or revoked users cannot dispatch or receive an allocation chart',async()=>{
  const a=await app();await a.request('POST',{},message('/allocation_chart',2),headers);assert.equal(a.dispatches.length,0);
  const b=await app();b.store.set('portfolio/access-control.json',{accessPolicy:{version:1,activated_at:ACCESS_POLICY_STARTED_AT},approved:['2'],pending:{},delegatedAdmins:[],users:{},audit:[]});
  await b.request('POST',{},message('/allocation_chart',2),headers);
  b.store.get('portfolio/latest-allocation/requests/'+jobId(b)+'.json').blackRockPriceRial=100000;
  b.store.get('portfolio/access-control.json').approved=[];await complete(b);
  assert.equal(b.marketCalls.length,0);assert.equal(b.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
});
