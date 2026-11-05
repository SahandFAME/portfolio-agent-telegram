import test from 'node:test';
import assert from 'node:assert/strict';
import {app,completeFreshReport} from './helpers/app-fixture.mjs';

const headers={'x-telegram-bot-api-secret-token':'fixture-webhook'};
async function report(a,text='/assets',id=1){
  await a.request('POST',{}, {message:{chat:{id,type:'private'},from:{id},text}},headers);
  await completeFreshReport(a,{id});
  return a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body)).at(-1);
}
const names=text=>[...text.matchAll(/^\d+\. (.*?): /gm)].map(x=>x[1].replace(/\*$/,''));

test('assets report groups all 29 holdings exactly once using allocation categories',async()=>{
  const a=await app();for(const asset of Object.keys(a.assets)){a.assets[asset]=1;a.payload.assets[asset]=1;}a.store.set('portfolio/latest.json',a.payload);
  const before=JSON.stringify(a.store.get('portfolio/latest.json'));
  const {text,reply_markup,parse_mode}=await report(a);
  assert.equal(names(text).length,29);
  assert.deepEqual(names(text).sort(),[...a.ns.ASSETS].sort());
  assert.deepEqual([...text.matchAll(/^(\d+)\. /gm)].map(x=>Number(x[1])),Array.from({length:29},(_,i)=>i+1));
  assert.equal(parse_mode,'HTML');
  assert.equal((text.match(/<b><i><u>/g)||[]).length,6);
  assert.ok(text.startsWith('دارایی‌های پرتفوی (۲۹ مورد)\n\n'));
  const group=title=>{
    const heading='<b><i><u>'+title+'</u></i></b>\n\n';
    assert.ok(text.includes(heading),'styled heading and blank line: '+title);
    return text.split(heading)[1].split('\n\n')[0];
  };
  assert.deepEqual(names(group('طلا و سکه')),['طلا','عیار','گوهر','آلتون','امرالد','زرفام',...Object.keys(a.ns.MANUAL).filter(x=>x!=='دلار')]);
  assert.deepEqual(names(group('نقره')),['شمش نقره 999']);
  assert.deepEqual(names(group('سهام و صندوق‌ها')),['نهال','طعام','استیل','فلز فارابی','پتروآگاه','خودران','بلک راک','سجام','فملی']);
  assert.deepEqual(names(group('رمزارزها')),['BTC','ETH','Link','ADA','SOL','ONDO']);
  assert.deepEqual(names(group('تتر')),['Tether']);
  assert.deepEqual(names(group('دلار')),['دلار']);
  assert.ok(text.includes('Snapshot: '+a.ns.boldPortfolioTime(a.store.get('portfolio/latest.json').updated_at)));
  for(const [asset,quantity] of Object.entries({...a.assets,...a.ns.MANUAL})){
    assert.ok(text.includes(a.ns.assetLabel(asset,{includePrivateNotes:true})+': '+Number(quantity).toLocaleString('en-US',{maximumFractionDigits:8})),asset);
  }
  assert.deepEqual(a.store.get('portfolio/latest.json').assets,a.assets);
  assert.ok(a.marketCalls.length>0);assert.equal(a.dispatches.length,1);
  assert.ok(reply_markup.keyboard);
});

test('missing source refresh never displays a cached or manual-only asset report',async()=>{
  const a=await app();
  await a.request('POST',{}, {message:{chat:{id:1,type:'private'},from:{id:1},text:'/assets'}},headers);
  await completeFreshReport(a,{ok:false});
  const text=JSON.parse(a.sends.filter(x=>x.url.endsWith('/sendMessage')).at(-1).options.body).text;
  assert.match(text,/دریافت تازه ناموفق/);assert.equal(names(text).length,0);assert.equal(a.marketCalls.length,0);
});

test('assets button gives the same report and preserves precise cached quantities and dated snapshot',async()=>{
  const a=await app({cryptoPriceUsd:200});a.payload.assets.BTC=0.01234567;a.payload.assets.ETH=0.123456;
  a.payload.updated_at='2026-01-01T00:00:00Z';a.store.set('portfolio/latest.json',a.payload);
  const slash=await report(a);const button=await report(a,'دارایی‌ها');
  assert.equal(button.text.replace(/Snapshot:.*/,''),slash.text.replace(/Snapshot:.*/,''));
  assert.ok(button.text.includes('BTC: 0.01234567'));assert.ok(button.text.includes('ETH: 0.123456'));
  assert.ok(button.text.includes('Snapshot: '+a.ns.boldPortfolioTime(a.store.get('portfolio/latest.json').updated_at)));assert.doesNotMatch(button.text,/۱۴۰۴\/۱۰\/۱۱/);
  assert.equal(button.text.includes('به‌روز'),false);
});

test('unapproved users cannot see categorized holdings',async()=>{
  const a=await app();a.store.set('portfolio/latest.json',a.payload);
  for(const command of ['/assets','دارایی‌ها']){
    const reply=await report(a,command,2);assert.equal(names(reply.text).length,0);
    assert.equal(reply.reply_markup.remove_keyboard,true);
  }
});
