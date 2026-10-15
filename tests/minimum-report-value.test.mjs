import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/app-fixture.mjs';

test('visibility uses total exact valuation: under 50,000 toman is hidden, the exact boundary is retained',async()=>{
  const a=await app();assert.equal(a.ns.MIN_REPORT_VALUE_RIAL,500000);
  const vals={BTC:499999.99,ETH:500000,Link:500000.01,ADA:0,SOL:undefined,ONDO:NaN};
  const before=JSON.stringify(vals);
  assert.deepEqual([...a.ns.visibleReportAssets(vals)],['ETH','Link']);
  assert.equal(JSON.stringify(vals),before);
});

const quantities=a=>Object.fromEntries([...a.ns.ASSETS].map(asset=>[asset,0]));
const quotePage=()=>`<h1>صندوق شاخصی بلک راک اکوکوچ</h1><table><caption>صندوق شاخصی بلک راک</caption><tr><th>قیمت هر واحد</th><td>10000 تومان</td></tr><tr><th>تاریخ به‌روزرسانی قیمت</th><td><time datetime="${new Date(Date.now()-60000).toISOString()}">now</time></td></tr></table>`;

test('text, pictured, category and pie reports remove small assets from rows, totals, groups and footnotes',async()=>{
  const a=await app(),q=quantities(a);
  q.BTC=.2499999995;q.ETH=.25;q.ADA=.25000001;q['بلک راک']=1;
  q['آبشده (شمش زربد)']=.00001;
  const before=JSON.stringify(q),report=await a.ns.prepareAllocation(q,100000);
  assert.deepEqual(Object.keys(report.vals),['ETH','ADA']);
  assert.ok(Math.abs(report.total-1000000.02)<1e-8);
  assert.equal(report.prices.BTC.priceUsd,2);
  const text=await a.ns.latestAllocationReport(q,100000,'text',a.payload);
  const body=text.messages.join('\n');
  assert.match(body,/۱\. <b>ETH<\/b>/);assert.match(body,/۲\. <b>ADA<\/b>/);
  assert.doesNotMatch(body,/BTC|بلک راک|شمش زربد|یادداشت دارایی‌ها|صندوق خصوصی/);
  assert.equal(text.total,report.total);
  const groups=a.ns.allocationGroups(report.vals,report.total);
  assert.equal(groups.find(x=>x.category==='رمز ارز').percentage,100);
  assert.equal(groups.find(x=>x.category==='سهام و صندوق').value,0);
  const svg=a.ns.buildPortfolioSvg(q,report.vals,report.total,report.prices,report.usdIrr);
  assert.ok(svg.includes('>ETH</text>'));assert.ok(svg.includes('>ADA</text>'));
  assert.doesNotMatch(svg,/>BTC<\/text>|بلک راک|شمش زربد|صندوق خصوصی|data-section="footnotes"|یادداشت دارایی‌ها|توضیحات/);
  const pie=a.ns.buildAllocationPieSvg(report,a.payload);
  assert.ok(pie.includes('data-category="رمز ارز" data-percentage="100"'));
  assert.doesNotMatch(pie,/درصد گروه‌ها بر اساس|دو رقم اعشار/);
  const chart=await a.ns.latestAllocationReport(q,100000,'chart',a.payload);
  assert.equal(chart.total,report.total);assert.equal(chart.captionFootnotes,'');
  const category=await a.ns.valuationReply(q,['BTC','ETH','ADA'],'رمزارز');
  assert.doesNotMatch(category,/BTC/);assert.match(category,/ارزش کل دارایی‌های این گزارش: <b>۱۰۰،۰۰۰ تومان<\/b>/);
  assert.equal(JSON.stringify(q),before);
});

test('quantity list checks current quotes, omits qualifying zero/small balances and retains exact-threshold quantities',async()=>{
  const a=await app({ecoCoachHtml:quotePage()}),q=quantities(a);
  q.BTC=.2499999995;q.ETH=.25;q['بلک راک']=1;
  const before=JSON.stringify(q);
  const text=await a.ns.filteredAssetsReply(q,a.payload);
  assert.match(text,/ETH: 0\.25/);assert.match(text,/۱ مورد/);
  assert.doesNotMatch(text,/BTC|بلک راک|یادداشت دارایی‌ها/);
  assert.equal(JSON.stringify(q),before);
  assert.ok(a.marketCalls.includes('https://ecocoach.net/blackrock-index'));
});

test('unknown prices/quantities cannot be hidden to bypass complete valuation; unpriced quantity-list entries stay visible',async()=>{
  const a=await app(),q=quantities(a);q['بلک راک']=1;delete q.BTC;
  const report=await a.ns.latestAllocationReport(q,100000,'text',a.payload);
  assert.match(report.text,/مقدار این دارایی‌ها موجود یا معتبر نیست/);
  assert.equal(report.total,undefined);assert.equal(report.png,undefined);
  const assets=await a.ns.filteredAssetsReply(q,a.payload);
  assert.match(assets,/BTC: همگام‌سازی نشده/);assert.match(assets,/بلک راک\*: 1/);
  assert.doesNotMatch(assets,/در فهرست باقی می‌مانند|در فهرست نمایش داده نمی‌شوند/);
  const b=await app({beforeMarketFetch:url=>{if(String(url).includes('coingecko'))throw new Error('fixture missing');}});
  const failed=await b.ns.latestAllocationReport(quantities(b),100000,'chart',b.payload);
  assert.equal(failed.png,undefined);assert.equal(failed.total,undefined);assert.match(failed.text,/قیمت ناموجود/);
});

test('several small assets in one group do not survive by pooling their values; empty selection produces no chart',async()=>{
  const a=await app(),q=quantities(a);q.ETH=.15;q.ADA=.15;
  const report=await a.ns.latestAllocationReport(q,100000,'chart',a.payload);
  assert.equal(report.empty,true);assert.match(report.text,/حداقل ۵۰،۰۰۰ تومان/);
  assert.equal(report.png,undefined);assert.equal(report.total,undefined);
  const category=await a.ns.valuationReply(q,['ETH','ADA'],'رمزارز');
  assert.doesNotMatch(category,/\. <b>ETH|\. <b>ADA/);
  assert.match(category,/هیچ دارایی با ارزش حداقل/);
});

test('stale quantity lists do not invent current valuations or rewrite stored holdings to enforce visibility',async()=>{
  const a=await app(),q=quantities(a);q.BTC=.001;
  const text=await a.ns.filteredAssetsReply(q,{...a.payload,updated_at:'2020-01-01T00:00:00Z'});
  assert.match(text,/BTC: 0\.001/);assert.match(text,/Snapshot: <b>/);
  assert.doesNotMatch(text,/برای اعمال حداقل ارزش نمایش/);
  assert.equal(a.marketCalls.length,0);assert.equal(a.writes.length,0);
});
