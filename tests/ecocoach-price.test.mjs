import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/app-fixture.mjs';

// Synthetic explicit quote markup. The live public fund page has no quote.
function table({price='850,000',currency='تومان',stamp=new Date(Date.now()-60000).toISOString(),caption='صندوق شاخصی بلک راک',label='قیمت هر واحد'}={}){
  return `<table><caption>${caption}</caption><tr><th>${label}</th><td>${price} ${currency}</td></tr><tr><th>تاریخ به‌روزرسانی قیمت</th><td><time datetime="${stamp}">${stamp}</time></td></tr></table>`;
}
const page=quote=>'<h1>صندوق شاخصی بلک راک اکوکوچ</h1>'+quote;
const q=a=>({...a.assets,...a.ns.MANUAL,'بلک راک':15});

test('EcoCoach per-unit quote requires matching fund identity, currency, provenance and a recent timestamp',async()=>{
  const a=await app(),now=Date.parse('2026-10-13T09:00:00Z'),stamp='2026-10-13T08:59:00Z';
  for(const [price,currency,expected] of [['850,000','تومان',8500000],['۸۵۰٬۰۰۰','IRT',8500000],['8,500,000','IRR',8500000],['۸٬۵۰۰٬۰۰۰','ریال',8500000],['۸۵۰۰۰۰٫۵','تومان',8500005]]){
    const quote=a.ns.parseEcoCoachPrice(page(table({price,currency,stamp})),now);
    assert.equal(quote.priceRial,expected);assert.equal(quote.unit,'IRR/unit');assert.equal(quote.source,'EcoCoach');
    assert.equal(quote.sourceUrl,'https://ecocoach.net/blackrock-index');
    assert.equal(quote.quotedAt,stamp.replace('Z','.000Z'));assert.equal(quote.retrievedAt,new Date(now).toISOString());
  }
});

test('unavailable, demo, ambiguous, stale, future, wrong-unit and unrelated BlackRock data cannot become a price',async()=>{
  const a=await app(),now=Date.parse('2026-10-13T09:00:00Z'),stamp=new Date(now).toISOString();
  const invalid=[
    page('<p>به زودی</p><p>شاخص صندوق بلک راک ۱۳۵۰ • بازده ۱۲٪</p>'),
    page(table({stamp,caption:'EcoCoach BlackRock — NYSE:BLK'})),
    page(table({stamp,caption:'صندوق شاخصی بلک راک — داده‌های فرضی'})),
    page(table({stamp,label:'ارزش خالص کل دارایی‌ها'})),
    page(table({stamp,currency:'USD'})),page(table({stamp,currency:''})),
    page(table({stamp,price:'0'})),page(table({stamp,price:'-50'})),page(table({stamp,price:'12,,3'})),
    page(table({stamp:'2026-10-11T09:00:00Z'})),page(table({stamp:'2026-10-14T09:00:00Z'})),
    page(table({stamp:'2026-10-13T09:00:00'})),page(table({stamp:'invalid'})),
    page(table({stamp})+table({stamp,price:'860,000'})),
    page('<script>'+table({stamp})+'</script>'),
    page(table({stamp,caption:'قیمت طلا'})),
    page(`<table><caption>صندوق شاخصی بلک راک</caption><tr><th>قیمت هر واحد</th><td>850000 تومان</td></tr></table><table><caption>صندوق شاخصی بلک راک</caption><tr><th>تاریخ به‌روزرسانی قیمت</th><td><time datetime="${stamp}">${stamp}</time></td></tr></table>`)
  ];
  for(const html of invalid)assert.throws(()=>a.ns.parseEcoCoachPrice(html,now),/ECOCOACH_PRICE_UNAVAILABLE/);
});

test('all complete formats first check the site; a valid site quote takes precedence over manual input and is counted exactly once',async()=>{
  for(const format of ['image','text','chart']){
    const a=await app({ecoCoachHtml:page(table())});
    const report=await a.ns.prepareAllocation(q(a),100000);
    assert.equal(report.prices['بلک راک'].source,'EcoCoach');assert.equal(report.prices['بلک راک'].priceRial,8500000);
    assert.equal(report.vals['بلک راک'],127500000);
    assert.equal(report.total,Object.values(report.vals).reduce((sum,value)=>sum+value,0));
    const output=await a.ns.latestAllocationReport(q(a),100000,format,a.payload);
    assert.equal(output.total,report.total);assert.equal(output.text,undefined);
    assert.equal(a.marketCalls.filter(url=>url==='https://ecocoach.net/blackrock-index').length,2);
  }
  const a=await app({ecoCoachHtml:page(table())});const prepared=await a.ns.prepareAllocation(q(a),100000);
  const legacy=await a.ns.allocationReply(q(a),100000);
  assert.ok(legacy.includes('<b>Total:</b> '+(prepared.total/10).toLocaleString('en-US',{maximumFractionDigits:8})+' toman'));
});

test('site failures preserve the manual prompt without partial totals and category-only reports do not need a fund lookup',async()=>{
  for(const options of [{},{ecoCoachError:true},{ecoCoachStatus:503},{ecoCoachHtml:page(table({stamp:'2020-01-01T00:00:00Z'}))}]){
    const a=await app(options),report=await a.ns.latestAllocationReport(q(a),null);
    assert.match(report.text,/قیمت فعلی هر واحد صندوق بلک راک/);assert.equal(report.png,undefined);assert.equal(report.total,undefined);
    assert.ok(a.marketCalls.includes('https://ecocoach.net/blackrock-index'));
    const manual=await a.ns.prepareAllocation(q(a),100000);
    assert.equal(manual.vals['بلک راک'],1500000);assert.equal(manual.prices['بلک راک'].source,'User input');
  }
  for(const names of [['BTC','ETH'],['دلار'],['آبشده (طلب)']]){
    const a=await app();await a.ns.valuationReply(q(a),names,'report');
    assert.equal(a.marketCalls.some(url=>url.startsWith('https://ecocoach.net/')),false);
  }
});

test('guest charts use an available site price with one fresh sync and no price prompts, total or notes',async()=>{
  const a=await app({ecoCoachHtml:page(table())});
  a.store.set('portfolio/access-control.json',{approved:['2'],pending:{},delegatedAdmins:[],users:{},audit:[]});
  await a.request('POST',{}, {message:{chat:{id:2,type:'private'},from:{id:2},text:'/allocation_chart'}},{'x-telegram-bot-api-secret-token':'fixture-webhook'});
  const id=JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
  const snapshot={...a.payload,assets:{...a.assets,'بلک راک':15},updated_at:new Date().toISOString()};a.store.set('portfolio/latest.json',snapshot);
  await a.request('POST',{complete:'latest-allocation'},{request_id:id,ok:true,snapshot_updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},{'x-portfolio-sync-secret':'fixture-secondary'});
  assert.equal(a.dispatches.length,1);
  const photos=a.sends.filter(call=>call.url.endsWith('/sendPhoto'));assert.equal(photos.length,1);
  assert.equal(photos[0].options.body.get('caption'),'نمودار درصد ترکیب دارایی');
  const text=a.sends.filter(call=>call.url.endsWith('/sendMessage')).map(call=>JSON.parse(call.options.body).text).join('\n');
  assert.doesNotMatch(text,/قیمت فعلی|تعداد:|تومان|یادداشت|بلک راک/);
});


test('guest-only owner-approved fallback converts 1,030,000 toman to rial and counts the fund once without claiming a quote',async()=>{
  for(const options of [{},{ecoCoachError:true},{ecoCoachStatus:503},{ecoCoachHtml:page(table({stamp:'2020-01-01T00:00:00Z'}))}]){
    const a=await app(options);
    // An old/manual request price cannot override the guest's fixed fallback.
    const report=await a.ns.prepareAllocation(q(a),100000,{guest:true});
    assert.equal(report.prices['بلک راک'].priceRial,10300000);
    assert.equal(report.prices['بلک راک'].unit,'IRR/unit');
    assert.equal(report.prices['بلک راک'].source,'Owner-approved guest fallback');
    assert.equal(report.prices['بلک راک'].fixedPrice,true);
    assert.equal(report.prices['بلک راک'].quotedAt,undefined);
    assert.equal(report.prices['بلک راک'].retrievedAt,undefined);
    assert.equal(report.vals['بلک راک'],154500000);
    assert.equal(Object.keys(report.vals).length,29);
    assert.equal(report.total,Object.values(report.vals).reduce((sum,value)=>sum+value,0));
    const output=await a.ns.latestAllocationReport(q(a),null,'chart',a.payload,{guest:true});
    assert.ok(output.png);assert.equal(output.total,undefined);assert.equal(output.captionFootnotes,undefined);
    const admin=await a.ns.prepareAllocation(q(a),null);
    assert.equal(admin.needsEcoCoachPrice,true);assert.equal(admin.total,undefined);
  }
});

test('verified website quote overrides the fixed guest fallback; missing other quantities or prices still block charts',async()=>{
  const a=await app({ecoCoachHtml:page(table())});
  const report=await a.ns.prepareAllocation(q(a),null,{guest:true});
  assert.equal(report.prices['بلک راک'].priceRial,8500000);
  assert.equal(report.prices['بلک راک'].source,'EcoCoach');assert.equal(report.prices['بلک راک'].fixedPrice,undefined);
  assert.equal(report.vals['بلک راک'],127500000);
  const invalid=q(a);delete invalid.BTC;
  const missing=await a.ns.latestAllocationReport(invalid,null,'chart',a.payload,{guest:true});
  assert.ok(missing.text);assert.equal(missing.png,undefined);assert.equal(missing.total,undefined);
  const unavailable=await app({beforeMarketFetch:()=>{throw new Error('fixture unavailable');}});
  const failed=await unavailable.ns.latestAllocationReport(q(unavailable),null,'chart',unavailable.payload,{guest:true});
  assert.ok(failed.text);assert.equal(failed.png,undefined);assert.equal(failed.total,undefined);
  assert.doesNotMatch(missing.text+failed.text,/بلک راک|BTC|تومان|EcoCoach|تعداد|یادداشت/);
});
