import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {app} from './helpers/app-fixture.mjs';

test('pictured report uses Persian headings, holdings, groups, units and a right-to-left table',async()=>{
  const a=await app();const q=Object.fromEntries([...a.ns.ASSETS].map(asset=>[asset,1]));q.BTC=0.00519153;q.ETH=0.40602;
  const data=await a.ns.prepareAllocation(q,100000);
  const svg=a.ns.buildPortfolioSvg(q,data.vals,data.total,data.prices,data.usdIrr);
  for(const label of ['گزارش ارزش‌گذاری و ترکیب دارایی','ترکیب دارایی','خلاصه پرتفوی','توضیحات','ردیف','دارایی','گروه','مقدار','واحد','قیمت واحد','ارزش (تومان)','ارزش (دلار)','درصد','منبع'])assert.ok(svg.includes('>'+label+'</text>'),label);
  for(const asset of a.ns.ASSETS)assert.ok(svg.includes('>'+asset+'</text>'),asset);
  assert.doesNotMatch(svg,/Portfolio Valuation|Asset Allocation|Portfolio Summary|Unit Price|Value \(toman\)|toman|EcoCoach Fund/);
  assert.ok(svg.includes('>صندوق طلا</text>'));assert.ok(svg.includes('>شاخص‌بان (بورس کالا)</text>'));
  assert.ok(svg.includes('>۰٫۰۰۵۲</text>'));assert.ok(svg.includes('>۰٫۴۰۶</text>'));
  const rank=svg.match(/<text x="([\d.]+)"[^>]*>ردیف<\/text>/),asset=svg.match(/<text x="([\d.]+)"[^>]*>دارایی<\/text>/);
  assert.ok(Number(rank[1])>Number(asset[1]));
  const picture=await a.ns.allocationImageReply(q,100000);
  assert.equal(picture.total,data.total);
  const metadata=await sharp(picture.png).metadata();assert.equal(metadata.width,1800);assert.equal(metadata.height,2160);
  assert.equal(q.BTC,0.00519153);assert.equal(q.ETH,0.40602);
});
