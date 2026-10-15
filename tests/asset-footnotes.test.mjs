import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {app} from './helpers/app-fixture.mjs';

const commented=['بلک راک','آبشده (طلب)','آبشده (شمش زربد)','دلار'];
const quantities=a=>({...a.assets,...a.ns.MANUAL,'بلک راک':15,BTC:.00519153,ETH:.40602});
const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const auth={'x-portfolio-sync-secret':'fixture-secondary'};
const message=(text,id=1)=>({message:{chat:{id,type:'private'},from:{id},text}});

test('asset list marks only the four commented holdings and preserves every canonical quantity and historical comment',async()=>{
  const a=await app(),q=quantities(a),before=JSON.stringify(q);
  const text=a.ns.assetsReply(q,a.payload);
  const rows=[...text.matchAll(/^\d+\. ([^\n]+): ([^\n]+)$/gm)];
  assert.equal(rows.length,29);
  for(const asset of a.ns.ASSETS){
    const label=asset+(commented.includes(asset)?'*':'');
    assert.ok(rows.some(row=>row[1]===label&&row[2]===Number(q[asset]).toLocaleString('en-US',{maximumFractionDigits:8})),asset);
  }
  assert.equal((text.match(/<b>یادداشت دارایی‌ها \(\*\)<\/b>/g)||[]).length,1);
  for(const asset of commented)assert.ok(text.includes('<b>'+asset+'*</b>: '+a.ns.ASSET_COMMENTS[asset]));
  assert.ok(text.includes('طلب از مامان به ازای ما به تفاوت خرید شمش زربد (9200 تومان در گرم طلا 6718)'));
  assert.ok(text.includes('شمش زربد (در گرم 6718)؛ 1404/01/26'));
  assert.ok(text.includes('700 دلار در 83000 (04/02/20)؛ 2300 دلار در 108800 (04/08/04)'));
  assert.ok(text.indexOf('یادداشت دارایی‌ها')>text.indexOf('Snapshot:'));
  assert.deepEqual(Object.keys(a.ns.ASSET_COMMENTS),commented);
  assert.equal(a.ns.ASSET_COMMENTS['بلک راک'],'صندوق خصوصی اکوکوچ');
  assert.equal(text.slice(text.indexOf('<b>یادداشت دارایی‌ها')), '<b>یادداشت دارایی‌ها (*)</b>\n'+commented.map(asset=>'<b>'+asset+'*</b>: '+a.ns.ASSET_COMMENTS[asset]).join('\n'));
  assert.ok(text.length<3900);assert.equal(JSON.stringify(q),before);
});

test('category footnotes are restricted to related assets and acquisition figures never replace live valuation',async()=>{
  const a=await app(),q=quantities(a),before=JSON.stringify(q);
  const gold=await a.ns.valuationReply(q,['آبشده (طلب)','آبشده (شمش زربد)'],'طلا و فلزات گرانبها');
  for(const asset of commented.slice(1,3)){assert.ok(gold.includes('<b>'+asset+'*</b>'));assert.ok(gold.includes(a.ns.ASSET_COMMENTS[asset]));}
  assert.doesNotMatch(gold,/بلک راک|خریدهای تاریخی:/);
  const cash=await a.ns.valuationReply(q,['دلار'],'دلار نقدی');
  assert.ok(cash.includes('مقدار: ۳٬۰۳۰ دلار • گروه: فیات'));
  assert.ok(cash.includes('ارزش کل دارایی‌های این گزارش: <b>۳۰۳،۰۰۰،۰۰۰ تومان</b>'));
  assert.ok(cash.includes(a.ns.ASSET_COMMENTS['دلار']));assert.doesNotMatch(cash,/آبشده|بلک راک/);
  const crypto=await a.ns.valuationReply(q,['BTC','ETH'],'رمزارز');
  assert.doesNotMatch(crypto,/یادداشت دارایی‌ها|خریدهای تاریخی|BTC\*|ETH\*/);
  const missing=await a.ns.valuationReply({...q,'آبشده (طلب)':undefined},['آبشده (طلب)'],'طلا');
  assert.match(missing,/آبشده \(طلب\)\*<\/b>\nارزش‌گذاری انجام نشد: مقدار دارایی موجود یا معتبر نیست/);assert.doesNotMatch(missing,/ارزش کل دارایی‌های این گزارش:/);
  assert.equal(JSON.stringify(q),before);
});

test('detailed text keeps qualifying asset rows, exact valuation, bounded chunks and footnotes at the end',async()=>{
  const a=await app(),q=quantities(a);
  const output=await a.ns.latestAllocationReport(q,100000,'text',a.payload);
  const data=await a.ns.prepareAllocation(q,100000);
  const text=output.messages.join('\n');
  const rows=[...text.matchAll(/^[۰-۹]+\. <b>([^<]+)<\/b>$/gm)];
  const shown=[...a.ns.visibleReportAssets(data.vals)];assert.equal(rows.length,shown.length);assert.equal(output.total,data.total);
  for(const [index,asset] of shown.entries())assert.equal(rows[index][1],asset+(commented.includes(asset)?'*':''));
  const notes=text.slice(text.indexOf('<b>یادداشت دارایی‌ها'));
  for(const asset of commented)assert.equal(notes.split('<b>'+asset+'*</b>:').length-1,1);
  assert.ok(output.messages.every(chunk=>chunk.length<=3500));
  assert.ok(output.messages.at(-1).includes('یادداشت دارایی‌ها'));
  assert.doesNotMatch(text,/کمتر از ۵۰،۰۰۰|اعداد یادداشت‌های خرید|قیمت واحد ابتدا|در صورت نبود قیمت معتبر/);
  assert.doesNotMatch(text,/\. <b>BTC<\/b>/);assert.ok(text.includes('مقدار: ۰٫۴۰۶۰۲ ETH'));
  assert.equal((output.percentages.match(/٪/g)||[]).length,6);
});

test('pictured footnotes use readable Persian EcoCoach text and remain inside an expanded footer and image',async()=>{
  const a=await app(),q=quantities(a),data=await a.ns.prepareAllocation(q,100000);
  const svg=a.ns.buildPortfolioSvg(q,data.vals,data.total,data.prices,data.usdIrr);
  const footer=svg.slice(svg.indexOf('<rect data-section="footnotes"'));
  const rect=footer.match(/y="(\d+)" width="1720" height="(\d+)"/);
  const texts=[...footer.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)<\/text>/g)];
  const imageHeight=Number(svg.match(/height="(\d+)"/)[1]);
  assert.equal(texts[0][3],'یادداشت دارایی‌ها (*)');
  for(const asset of commented){
    assert.ok(svg.includes('>'+asset+'*</text>'),asset);
    assert.ok(footer.includes(asset+'*: '),asset);
  }
  assert.ok(footer.includes('بلک راک*: صندوق خصوصی اکوکوچ'));
  assert.deepEqual(texts.slice(1).map(node=>node[3]).sort(),commented.map(asset=>asset+'*: '+a.ns.ASSET_COMMENTS[asset]).sort());
  assert.doesNotMatch(footer,/EcoCoach|<tspan|قیمت واحد رمزارزها|ارزش دلاری سایر|ارزش دلاری رمزارزها|کمتر از ۵۰،۰۰۰|اعداد یادداشت‌های خرید/);
  assert.ok(imageHeight>1000);
  for(const node of texts){assert.equal(+node[1],1730);assert.ok(+node[2]<+rect[1]+Number(rect[2])-20);}
  assert.ok(+rect[1]+Number(rect[2])<imageHeight);
  const metadata=await sharp(a.ns.renderAllocationSvg(svg)).metadata();assert.equal(metadata.height,imageHeight);
  const long='یادداشت آزمایشی با کلمات فارسی '.repeat(30).trim();
  const lines=a.ns.wrapReportText(long);
  assert.ok(lines.every(line=>line.length<=145));assert.equal(lines.join(' '),long);
});

test('chart footnotes are delivered below the image within the Telegram caption limit, with access checks preserved',async()=>{
  const a=await app();
  await a.request('POST',{},message('/allocation_chart'),header);
  const id=JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
  a.store.get('portfolio/latest-allocation/requests/'+id+'.json').blackRockPriceRial=100000;
  const snapshot={...a.payload,assets:{...a.assets,'بلک راک':15},updated_at:new Date().toISOString()};
  a.store.set('portfolio/latest.json',snapshot);
  await a.request('POST',{complete:'latest-allocation'},{request_id:id,ok:true,snapshot_updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},auth);
  const photo=a.sends.find(send=>send.url.endsWith('/sendPhoto'));assert.ok(photo);
  const caption=photo.options.body.get('caption');
  assert.ok(caption.startsWith('نمودار ترکیب دارایی'));
  assert.ok(caption.length<=1024);assert.doesNotMatch(caption,/<b>|<\/b>/);
  assert.equal(caption.slice(caption.indexOf('یادداشت دارایی‌ها')),a.ns.assetFootnotes(commented,{html:false}));
  const b=await app();b.store.set('portfolio/latest.json',b.payload);
  await b.request('POST',{},message('/assets',2),header);
  assert.equal(b.sends.some(send=>JSON.parse(send.options.body).text?.includes('طلب از مامان')),false);
});
