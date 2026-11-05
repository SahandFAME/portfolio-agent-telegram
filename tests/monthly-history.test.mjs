import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateGoldWeek,mergeGoldWeeks,initialMonthEnds,solarMonthKey,isSolarMonthEnd,solarMonthEnd,goldHistorySummary,goldHistorySvg,collectHistoryPriceEvidence,applyHistoryPriceFallbacks,LAST_KNOWN_POLICY} from '../lib/gold-history.js';
import {app,completeFreshReport} from './helpers/app-fixture.mjs';
const now=Date.parse('2026-11-23T12:00:00Z');
const opts={assets:['stock'],groups:{stock:'stock'},now,historicalPricePolicy:LAST_KNOWN_POLICY,priceInputsRevision:'test'};
const input=(end,value=100,mode='historical',observed=end)=>({period_kind:'monthly',week_ending:end,mode,as_of:observed+'T20:00:00Z',source_checked_at:'2026-11-23T10:00:00Z',workbook_updated_at:'2026-10-20T00:00:00Z',workbook_sha256:'a'.repeat(64),quantities:{stock:10},quotes:{stock:{price_rial:value*1000000,source:'Synthetic IRR/unit',quoted_at:observed+'T20:00:00Z'}},gold_quote:{price_rial:10000000,source:'Synthetic 18K gram',quoted_at:observed+'T20:00:00Z'},issues:[]});

test('Persian calendar detects actual month ends, year rollover and the 12 completed baseline months',()=>{
  assert.equal(solarMonthKey('2026-03-20T12:00:00Z'),'1404/12');assert.equal(solarMonthKey('2026-03-21T12:00:00Z'),'1405/01');
  for(const d of ['2025-11-21','2026-01-20','2026-03-20','2026-10-22'])assert.equal(isSolarMonthEnd(d),true);
  assert.equal(isSolarMonthEnd('2026-10-21'),false);assert.equal(solarMonthEnd('2026-10-29'),'2026-11-21');
  const days=initialMonthEnds();assert.equal(days.length,12);assert.equal(days[0],'2025-11-21');assert.equal(days.at(-1),'2026-10-22');
  assert.ok(days.every(isSolarMonthEnd));
});

test('monthly changes use adjacent Persian months rather than seven-day intervals and do not bridge missing months',()=>{
  const rows=mergeGoldWeeks([],[input('2026-01-20',100),input('2026-02-19',90),input('2026-03-20',110)],opts);
  assert.equal(rows[1].change_gold_grams,-10);assert.equal(rows[1].change_percent,-10);
  assert.equal(rows[2].change_gold_grams,20);assert.ok(Math.abs(rows[2].change_percent-20/90*100)<1e-10);
  const gap=mergeGoldWeeks([],[input('2026-01-20'),input('2026-03-20')],opts);assert.equal(gap[1].change_percent,null);
  assert.throws(()=>calculateGoldWeek(input('2026-03-19'),opts));
});

test('current-month estimates remain provisional and later finalize at their actual month-end without using future prices',()=>{
  const partial=input('2026-11-21',105,'baseline','2026-10-29');
  const row=calculateGoldWeek(partial,opts);assert.equal(row.provisional,true);assert.equal(row.month_key,'1405/08');
  const updated=mergeGoldWeeks([row],[input('2026-11-21',110,'baseline','2026-11-01')],opts)[0];assert.equal(updated.gold_grams,110);
  const closed=mergeGoldWeeks([updated],[input('2026-11-21',120)],opts)[0];assert.equal(closed.provisional,false);assert.equal(closed.gold_grams,120);
  const bad=structuredClone(partial);bad.quotes.stock.quoted_at='2026-11-01T00:00:00Z';assert.equal(calculateGoldWeek(bad,opts).status,'incomplete');
  assert.throws(()=>calculateGoldWeek({...partial,mode:'historical'},opts));
});

test('monthly text contains the approved summary and each month change table, labels estimates/current month, and fits Telegram',()=>{
  const rows=mergeGoldWeeks([],[input('2026-09-22',100),input('2026-10-22',90),input('2026-11-21',110,'baseline','2026-10-29')],opts);
  rows[1].valuation_basis='estimated_last_known';
  const text=goldHistorySummary(rows,{formatTime:s=>s.split('T')[0]});
  for(const value of ['ابتدای بازه','آخرین مقدار','تغییر ارزش','کمترین مقدار','بیشترین مقدار','تغییر گرم','تغییر٪','۱۴۰۵/۰۶','۱۴۰۵/۰۷','۱۴۰۵/۰۸','−۱۰٫۰۰','+۲۰٫۰۰','موقت','برآورد'])assert.ok(text.includes(value),value);
  assert.ok(text.length<4096);assert.doesNotMatch(text,/NaN|Infinity|هفتگی/);
  const svg=goldHistorySvg(rows,{formatTime:s=>s,escape:s=>String(s),number:String});assert.match(svg,/ارزش ماهانه/);assert.match(svg,/موقت/);assert.equal((svg.match(/<circle /g)||[]).length,3);
});

test('calendar migration preserves the latest dated evidence even when its old weekly row is archived',()=>{
  const closed=calculateGoldWeek(input('2026-10-22',100),opts);
  const evidence=collectHistoryPriceEvidence({weeks:[{quotes:{stock:{price_rial:120000000,quoted_at:'2026-10-28T10:00:00Z',source:'Admin confirmed for recorded week'}},gold_quote:closed.gold_quote}]});
  const partial=input('2026-11-21',100,'baseline','2026-10-29');partial.quotes={};partial.gold_quote=null;
  const result=applyHistoryPriceFallbacks([closed,calculateGoldWeek(partial,opts)],[],{...opts,priceEvidence:evidence});
  assert.equal(result[1].gold_grams,120);assert.equal(result[1].quotes.stock.quoted_at,'2026-10-28T10:00:00Z');assert.equal(result[1].valuation_basis,'estimated_last_known');
  assert.equal(result[0].gold_grams,100);
});

test('monthly text accompanies the chart only for current report readers and Excel stays admin only',async()=>{
  for(const uid of [1,2,3,4]){
    const a=await app();a.store.set('portfolio/access-control.json',{approved:['2','3','4'],delegatedAdmins:['3'],financialAdvisors:['2'],users:{},pending:{},audit:[],accessPolicy:{version:1,activated_at:new Date().toISOString()}});
    const rows=mergeGoldWeeks([],[input('2026-09-22',100),input('2026-10-22',110)],opts);
    a.store.set('portfolio/gold-history/latest.json',{version:1,calendar:'persian-month-end-v1',revision:'monthly-fixture',weeks:rows});
    await a.request('POST',{}, {message:{chat:{id:uid,type:'private'},from:{id:uid},text:'/gold_history'}},{'x-telegram-bot-api-secret-token':'fixture-webhook'});
    await completeFreshReport(a,{id:uid});
    const texts=a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));
    assert.equal(texts.some(m=>m.text.includes('خلاصه روند ماهانه')),[1,2,3].includes(uid));
    assert.equal(texts.some(m=>m.reply_markup?.inline_keyboard?.flat().some(b=>b.callback_data==='history:excel')),[1,3].includes(uid));
  }
});


test('archived evidence cannot override a freshly fetched closing price at the same timestamp',()=>{
  const fresh=calculateGoldWeek(input('2026-10-22',120),opts);
  const stale={asset:'stock',price_rial:100000000,quoted_at:fresh.quotes.stock.quoted_at,source:'Synthetic IRR/unit'};
  const row=applyHistoryPriceFallbacks([fresh],[],{...opts,priceEvidence:[stale]})[0];assert.equal(row.gold_grams,120);
  const owner={...stale,source:'Owner supplied dated historical unit price',price_rial:130000000};
  assert.equal(applyHistoryPriceFallbacks([fresh],[owner],{...opts,priceEvidence:[stale]})[0].gold_grams,130);
});

test('fresh provisional quantities replace a complete estimate after applying authorized price evidence',async()=>{
  let clock=Date.parse('2026-11-05T12:00:00Z');
  const a=await app({now:()=>clock}),key='portfolio/gold-history/latest.json';
  a.store.set(key,{version:1,revision:'initial',weeks:[],historical_price_policy:LAST_KNOWN_POLICY,
    price_inputs:[{asset:'بلک راک',price_rial:10000000,source:'Owner supplied dated historical unit price',quoted_at:'2026-10-28T10:00:00Z'}]});
  const body=()=>({assets:{...a.assets,'بلک راک':15,BTC:1},source_checked_at:new Date(clock).toISOString(),workbook_updated_at:'2026-11-05T10:00:00Z',workbook_sha256:'a'.repeat(64),additional_quantities:{XAUT:0,'اهرم':0},bootstrap:true,notify:false});
  const auth={'x-portfolio-sync-secret':'fixture-secondary'};
  assert.equal((await a.request('POST',{sync:'gold-observation'},body(),auth)).code,200);
  const old=structuredClone(a.store.get(key).weeks[0]);assert.equal(old.status,'complete');
  clock+=3600000;const fresh=body();fresh.assets.BTC=12;
  assert.equal((await a.request('POST',{sync:'gold-observation'},fresh,auth)).code,200);
  const updated=a.store.get(key).weeks[0];
  assert.equal(updated.status,'complete');assert.equal(updated.source_checked_at,fresh.source_checked_at);
  assert.equal(updated.quantities.BTC,12);assert.ok(updated.gold_grams>old.gold_grams);
  assert.equal(updated.quotes['بلک راک'].quoted_at,'2026-10-28T10:00:00Z');
  assert.equal(updated.valuation_basis,'estimated_last_known');assert.equal(a.sends.length,0);
});

test('later provisional captures update live month-end observations while completed historical months remain protected',()=>{
  const first=input('2026-10-22',100,'live'),next=input('2026-10-22',120,'baseline');next.as_of='2026-10-22T20:01:00Z';
  assert.equal(mergeGoldWeeks([calculateGoldWeek(first,opts)],[next],opts)[0].gold_grams,120);
  const closed=calculateGoldWeek(input('2026-10-22',130),opts);
  assert.equal(mergeGoldWeeks([closed],[next],opts)[0].gold_grams,130);
});
