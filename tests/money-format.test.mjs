import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/app-fixture.mjs';

test('whole-toman rounding and requested Persian/English dollar punctuation handle boundaries and small amounts',async()=>{
  const {ns}=await app();
  for(const [amount,fa,en] of [[1234.49,'۱،۲۳۴','1,234'],[1234.5,'۱،۲۳۵','1,235'],[999.5,'۱،۰۰۰','1,000'],[.49,'۰','0'],[.5,'۱','1']]){
    assert.equal(ns.formatTomanAmount(amount),fa);assert.equal(ns.formatTomanAmount(amount,{persian:false}),en);
  }
  assert.equal(ns.monetaryNumber(1234.5678,{decimals:2,fixed:true}),'۱،۲۳۴/۵۷');
  assert.equal(ns.monetaryNumber(1234.5678,{persian:false,decimals:2,fixed:true}),'1,234.57');
  assert.equal(ns.monetaryNumber(.00519153),'۰/۰۰۵۱۹۱۵۳');
});

test('text, pictured and chart reports round money only, retaining exact values, quantities and percentages',async()=>{
  const a=await app(),q={...a.assets,...a.ns.MANUAL,BTC:.00519153,ETH:.40602},before=JSON.stringify(q);
  const data=await a.ns.prepareAllocation(q,12345.67);
  assert.ok(Math.abs(data.vals.BTC-10383.06)<1e-8);
  const text=await a.ns.latestAllocationReport(q,12345.67,'text',a.payload);
  const body=text.messages.join('\n');
  assert.equal(text.total,data.total);
  assert.match(body,/مقدار: ۰٫۰۰۵۱۹۱۵۳ BTC/);
  assert.match(body,/ارزش: <b>۱،۰۳۸ تومان<\/b>/);
  for(const line of body.split('\n').filter(line=>/تومان/.test(line)&&!/یادداشت|خرید تاریخی/.test(line))){
    assert.doesNotMatch(line,/[۰-۹][٫\/][۰-۹]/);
  }
  const svg=a.ns.buildPortfolioSvg(q,data.vals,data.total,data.prices,data.usdIrr);
  assert.match(svg,/>۱،۰۳۸<\/text>/);
  assert.match(svg,/>۰٫۰۰۵۲<\/text>/);
  assert.ok(svg.includes('>۰/۰۱ دلار</text>'));
  assert.doesNotMatch(svg,/[۰-۹]٫[۰-۹]+ دلار/);
  const chart=a.ns.buildAllocationPieSvg(data,a.payload);
  assert.ok(chart.includes(a.ns.formatTomanAmount(data.total/10)+' تومان'));
  assert.equal(JSON.stringify(q),before);
  const english=await a.ns.allocationReply(q,12345.67);
  assert.ok(english.includes('<b>Total:</b> '+a.ns.formatTomanAmount(data.total/10,{persian:false})+' toman'));
});
