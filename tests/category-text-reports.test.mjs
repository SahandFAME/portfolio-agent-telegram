import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/app-fixture.mjs';

const headers={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const gold=['طلا','عیار','گوهر','آلتون','امرالد','زرفام','سکه تمام','ربع سکه غیره','ربع سکه بانکی','آبشده (طلب)','آبشده (شمش زربد)','شمش نقره 999'];
const crypto=['BTC','ETH','Tether','Link','ADA','SOL','ONDO'];
const money=value=>Math.round(Number(value)).toLocaleString('fa-IR',{maximumFractionDigits:0}).replace(/٬/g,'،');
const number=value=>Number(value).toLocaleString('fa-IR',{maximumFractionDigits:8});
const messages=a=>a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));
const request=(a,text,id=1)=>a.request('POST',{}, {message:{chat:{id,type:'private'},from:{id},text}},headers);
const q=a=>({...Object.fromEntries(Object.keys(a.assets).map(asset=>[asset,1])),...a.ns.MANUAL,BTC:.00519153,ETH:.40602,Tether:2617.574383,'طلا':386,'شمش نقره 999':256});

for(const [command,names,title] of [['/crypto',crypto,'رمزارز'],['/gold_and_other_precious_metals',gold,'طلا و فلزات گرانبها'],['/cash_dollar',['دلار'],'دلار نقدی']]){
  test(`${command} uses complete numbered Persian asset blocks and the correct category-only toman total`,async()=>{
    const a=await app({cryptoPriceUsd:200}),quantities=q(a),snapshot={...a.payload,assets:Object.fromEntries(Object.keys(a.assets).map(asset=>[asset,quantities[asset]]))};
    a.store.set('portfolio/latest.json',snapshot);const before=JSON.stringify(snapshot);
    await request(a,command);
    const chunks=messages(a),text=chunks.map(x=>x.text).join('\n\n');
    assert.ok(text.startsWith('<b>گزارش تفصیلی '+title+'</b>\n'));
    assert.match(text,/آخرین همگام‌سازی مقادیر: <b>[۰-۹]{4}\/.*\(تهران\)<\/b>/);
    assert.match(text,/قیمت‌های بازار: <b>[۰-۹]{4}\/.*\(تهران\)<\/b>/);
    const rows=[...text.matchAll(/^([۰-۹]+)\. <b>([^<]+)<\/b>$/gm)];
    assert.equal(rows.length,names.length);
    const {prices}=await a.ns.getPrices({includeEcoCoach:false});let total=0;
    for(const [index,asset] of names.entries()){
      assert.equal(rows[index][1],number(index+1));assert.equal(rows[index][2],a.ns.assetLabel(asset));
      const value=a.ns.valueRial(asset,quantities[asset],prices[asset],prices['دلار'].priceRial);total+=value;
      const unit=crypto.includes(asset)?asset:asset==='دلار'?'دلار':gold.includes(asset)&&asset.startsWith('آبشده')?'گرم':null;
      assert.ok(text.includes('مقدار: '+number(quantities[asset])+(unit?' '+unit:'')));
      assert.ok(text.includes('ارزش: <b>'+money(value/10)+' تومان</b>'));
      assert.match(text,/• گروه: /);assert.match(text,/قیمت واحد: .* • منبع: /);
    }
    assert.ok(text.includes('ارزش کل دارایی‌های این گزارش: <b>'+money(total/10)+' تومان</b>'));
    assert.ok(chunks.every(chunk=>chunk.text.length<=3500&&chunk.parse_mode==='HTML'));
    assert.doesNotMatch(text,/Subtotal|Prices retrieved| = |ارزش کل پرتفوی|بلک راک|EcoCoach/);
    if(command==='/crypto'){
      assert.ok(text.includes('مقدار: ۰٫۰۰۵۱۹۱۵۳ BTC'));assert.ok(text.includes('مقدار: ۰٫۴۰۶۰۲ ETH'));
      assert.doesNotMatch(text,/یادداشت دارایی‌ها/);
      assert.ok(text.includes('قیمت واحد: ۲۰۰ دلار • منبع: CoinGecko'));
      assert.ok(text.includes('ارزش: <b>۱۰۳،۸۳۱ تومان</b>'));
    }
    if(command.includes('gold')){
      assert.doesNotMatch(text,/طعام|نهال|خریدهای تاریخی:/);
      assert.ok(text.includes('ارزش: <b>۲۷،۴۰۰،۰۰۰ تومان</b>'));
      assert.ok(text.includes('قیمت واحد: ۲۰،۰۰۰،۰۰۰ تومان'));
    }
    if(command==='/cash_dollar'){
      assert.match(text,/دلار\*<\/b>/);
      assert.ok(text.includes('ارزش: <b>۳۰۳،۰۰۰،۰۰۰ تومان</b>'));
    }
    const footer=text.indexOf('<b>یادداشت دارایی‌ها');
    if(footer>=0)assert.ok(footer>text.indexOf(rows.at(-1)[0]));
    assert.equal(JSON.stringify(a.store.get('portfolio/latest.json')),before);assert.equal(a.dispatches.length,0);
  });
}

test('category reports share the allocation text row format without changing precision or live arithmetic',async()=>{
  const a=await app(),quantities=q(a);
  const allocation=await a.ns.latestAllocationReport(quantities,100000,'text',a.payload);
  const full=allocation.messages.join('\n\n');
  for(const [names,title] of [[crypto,'رمزارز'],[gold,'طلا و فلزات گرانبها'],[['دلار'],'دلار نقدی']]){
    const category=await a.ns.valuationReply(quantities,names,title,a.payload);
    for(const asset of names){
      const label=a.ns.assetLabel(asset),start=category.indexOf('. <b>'+label+'</b>');
      const block=category.slice(start).split('\n\n')[0];
      assert.ok(full.includes(block),asset);
    }
  }
});

test('missing quantity or market quote is clearly labelled and never creates a partial category total',async()=>{
  const a=await app(),quantities=q(a);delete quantities.BTC;
  const missing=await a.ns.valuationReply(quantities,crypto,'رمزارز');
  assert.match(missing,/<b>گزارش ناقص است؛ جمع کل ارائه نمی‌شود\.<\/b>/);
  assert.match(missing,/۱\. <b>BTC<\/b>\nارزش‌گذاری انجام نشد: مقدار/);
  assert.doesNotMatch(missing,/ارزش کل دارایی‌های این گزارش:/);
  const b=await app({beforeMarketFetch:url=>{if(String(url).includes('coingecko'))throw new Error('fixture missing quote');}});
  const failed=await b.ns.valuationReply(q(b),crypto,'رمزارز');
  assert.match(failed,/ارزش‌گذاری انجام نشد: قیمت معتبر دریافت نشد/);
  assert.doesNotMatch(failed,/ارزش کل دارایی‌های این گزارش:|ارزش: <b>/);
});

test('long category reports split only between complete assets and keep related footnotes last',async()=>{
  const a=await app(),snapshot={...a.payload,assets:{...a.assets}};
  for(const asset of gold)if(asset in snapshot.assets)snapshot.assets[asset]=1e90;
  a.store.set('portfolio/latest.json',snapshot);await request(a,'/gold');
  const chunks=messages(a).map(x=>x.text);assert.ok(chunks.length>1);
  assert.ok(chunks.every(chunk=>chunk.length<=3500));
  for(const chunk of chunks){
    const starts=(chunk.match(/^[۰-۹]+\. <b>/gm)||[]).length;
    assert.equal((chunk.match(/^قیمت واحد:/gm)||[]).length,starts);
    assert.equal((chunk.match(/<b>/g)||[]).length,(chunk.match(/<\/b>/g)||[]).length);
  }
  assert.match(chunks.at(-1),/یادداشت دارایی‌ها/);
  assert.equal(chunks.join('\n').match(/^[۰-۹]+\. <b>/gm).length,gold.length);
});

test('demotion after the first category chunk prevents further detailed report delivery',async()=>{
  let a;
  a=await app({telegramReply:call=>{
    if(call.url.endsWith('/sendMessage')&&JSON.parse(call.options.body).text.startsWith('<b>گزارش تفصیلی')){
      a.store.get('portfolio/access-control.json').delegatedAdmins=[];
    }
  }});
  a.store.set('portfolio/access-control.json',{approved:['3'],delegatedAdmins:['3'],pending:{},users:{},audit:[]});
  const snapshot={...a.payload,assets:{...a.assets}};
  for(const asset of gold)if(asset in snapshot.assets)snapshot.assets[asset]=1e90;
  a.store.set('portfolio/latest.json',snapshot);await request(a,'/gold',3);
  assert.equal(messages(a).length,1);assert.doesNotMatch(messages(a)[0].text,/یادداشت دارایی‌ها/);
});
