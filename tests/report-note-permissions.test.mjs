import test from 'node:test';
import assert from 'node:assert/strict';
import {app,startLatest} from './helpers/app-fixture.mjs';

const ACCESS_POLICY_STARTED_AT=new Date().toISOString();

const KEY='portfolio/access-control.json';
const headers={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const auth={'x-portfolio-sync-secret':'fixture-secondary'};
const historical=['آبشده (طلب)','آبشده (شمش زربد)','دلار'];
const messages=a=>a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));
const request=(a,text,id)=>a.request('POST',{}, {message:{chat:{id,type:'private'},from:{id},text}},headers);
const requestId=a=>JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
async function fixture(options={}){
  const a=await app(options);
  a.store.set(KEY,{accessPolicy:{version:1,activated_at:ACCESS_POLICY_STARTED_AT},approved:['2','3','4'],delegatedAdmins:['3'],financialAdvisors:['2'],pending:{},users:{},audit:[]});
  for(const asset of Object.keys(a.assets))a.assets[asset]=asset==='بلک راک'?15:1;
  a.store.set('portfolio/latest.json',a.payload);
  return a;
}
async function complete(a){
  const id=requestId(a);
  a.store.get('portfolio/latest-allocation/requests/'+id+'.json').blackRockPriceRial=10000000;
  const snapshot={...a.payload,assets:{...a.assets},updated_at:new Date().toISOString()};
  a.store.set('portfolio/latest.json',snapshot);
  return a.request('POST',{complete:'latest-allocation'},{request_id:id,ok:true,snapshot_updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},auth);
}
function noHistorical(a,text){
  for(const asset of historical){
    assert.equal(text.includes(a.ns.ASSET_COMMENTS[asset]),false,asset+' comment');
    assert.equal(text.includes(asset+'*'),false,asset+' marker');
  }
}

test('owners and delegated admins retain related comments; advisors see only the BlackRock note',async()=>{
  for(const uid of [1,3,2]){
    for(const command of ['/assets','/gold','/cash_dollar']){
      const a=await fixture();await request(a,command,uid);
      const text=messages(a).map(x=>x.text).join('\n');
      assert.ok(text.includes('دارایی'));
      if(uid===2){
        noHistorical(a,text);
        if(command==='/assets')assert.ok(text.includes('<b>بلک راک*</b>: صندوق خصوصی اکوکوچ'));
        else assert.doesNotMatch(text,/یادداشت دارایی‌ها|\*/);
      }else{
        const related=command==='/assets'?historical:command==='/gold'?historical.slice(0,2):['دلار'];
        for(const asset of related){assert.ok(text.includes(a.ns.ASSET_COMMENTS[asset]));assert.ok(text.includes(asset+'*'));}
      }
    }
  }
});

test('latest text, real rendered images and chart captions apply the current role note policy',async()=>{
  for(const uid of [1,3,2,4]){
    for(const format of uid===4?['chart']:['text','image','chart']){
      const a=await fixture();
      if(format==='chart')await request(a,'/allocation_chart',uid);
      else await startLatest(a,{id:uid,format});
      a.sends.length=0;await complete(a);
      const photo=a.sends.find(x=>x.url.endsWith('/sendPhoto'));
      const text=messages(a).map(x=>x.text).join('\n')+(photo?.options.body.get('caption')||'');
      const content=text+a.renderedSvgs.join('\n');
      if(uid===4){
        assert.ok(photo);assert.doesNotMatch(content,/صندوق خصوصی|یادداشت دارایی‌ها|ارزش کل|تومان/);noHistorical(a,content);
      }else{
        assert.ok(format==='text'?messages(a).some(x=>x.text.includes('ارزش کل گزارش')):photo);
        assert.match(content,/بلک راک\*[^\n]*صندوق خصوصی اکوکوچ/);
        if(uid===2)noHistorical(a,content);
        else for(const asset of historical)assert.ok(content.includes(a.ns.ASSET_COMMENTS[asset]),asset);
      }
    }
  }
});

test('renderers default to hiding historical comments, including errors and reports with no permitted footnotes',async()=>{
  const a=await fixture(),q={...a.assets,...a.ns.MANUAL};
  noHistorical(a,a.ns.assetsReply(q,a.payload));
  const invalid={...q};delete invalid['آبشده (طلب)'];
  const failed=await a.ns.latestAllocationReport(invalid,10000000,'text',a.payload);
  assert.match(failed.text,/مقدار این دارایی‌ها موجود یا معتبر نیست/);noHistorical(a,failed.text);
  const admin=await a.ns.latestAllocationReport(invalid,10000000,'text',a.payload,{includePrivateNotes:true});
  assert.ok(admin.text.includes(a.ns.ASSET_COMMENTS['آبشده (طلب)']));
  const unavailable=await fixture({beforeMarketFetch:url=>{if(String(url).includes('geram18'))throw new Error('synthetic quote unavailable');}});
  const missingPrice=await unavailable.ns.latestAllocationReport(q,10000000,'text',unavailable.payload);
  assert.match(missingPrice.text,/قیمت ناموجود\/نامعتبر/);noHistorical(unavailable,missingPrice.text);
  q['بلک راک']=0;
  const report=await a.ns.latestAllocationReport(q,10000000,'image',a.payload);
  assert.ok(report.png.length>1000);
  const svg=a.renderedSvgs.at(-1);noHistorical(a,svg);
  assert.doesNotMatch(svg,/data-section="footnotes"|یادداشت دارایی‌ها/);
  const ownerReport=await a.ns.latestAllocationReport(q,10000000,'text',a.payload,{includePrivateNotes:true});
  const advisorReport=await a.ns.latestAllocationReport(q,10000000,'text',a.payload);
  assert.equal(ownerReport.total,advisorReport.total);assert.equal(ownerReport.percentages.split('قیمت‌های بازار:')[0],advisorReport.percentages.split('قیمت‌های بازار:')[0]);
});

test('admin demotion to advisor during price retrieval blocks private category, text, image and chart delivery',async()=>{
  for(const format of ['/assets','/gold','/cash_dollar','text','image','chart']){
    const a=await fixture({beforeMarketFetch:(_url,store)=>{
      const access=store.get(KEY);access.delegatedAdmins=[];access.financialAdvisors=['2','3'];
    }});
    if(format.startsWith('/'))await request(a,format,3);
    else{
      if(format==='chart')await request(a,'/allocation_chart',3);else await startLatest(a,{id:3,format});
      a.sends.length=0;await complete(a);
    }
    assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false,format);
    assert.equal(messages(a).length,0,format);
  }
});

test('demotion while OneDrive sync is pending renders a fresh advisor report without private comments',async()=>{
  for(const format of ['text','image','chart']){
    const a=await fixture();
    if(format==='chart')await request(a,'/allocation_chart',3);else await startLatest(a,{id:3,format});
    a.store.get(KEY).delegatedAdmins=[];a.store.get(KEY).financialAdvisors=['2','3'];
    a.sends.length=0;await complete(a);
    const photo=a.sends.find(x=>x.url.endsWith('/sendPhoto'));
    assert.ok(format==='text'?messages(a).some(x=>x.text.includes('ارزش کل گزارش')):photo);
    const content=messages(a).map(x=>x.text).join('\n')+(photo?.options.body.get('caption')||'')+a.renderedSvgs.join('\n');
    noHistorical(a,content);assert.match(content,/صندوق خصوصی اکوکوچ/);
  }
});

test('admin demotion between text chunks stops the remaining private report and its footnotes',async()=>{
  let a,demoted=false;
  a=await fixture({telegramReply:call=>{
    if(call.url.endsWith('/sendMessage')&&JSON.parse(call.options.body).text.startsWith('<b>گزارش تفصیلی')){
      const access=a.store.get(KEY);access.delegatedAdmins=[];access.financialAdvisors=['2','3'];demoted=true;
    }
    return null;
  }});
  await startLatest(a,{id:3,format:'text'});a.sends.length=0;await complete(a);
  assert.equal(demoted,true);assert.equal(messages(a).length,1);
  for(const asset of historical)assert.equal(messages(a)[0].text.includes(a.ns.ASSET_COMMENTS[asset]),false);
  assert.doesNotMatch(messages(a)[0].text,/یادداشت دارایی‌ها/);
});

test('pending legacy EcoCoach image replies also hide historical notes from advisors',async()=>{
  const a=await fixture();
  a.store.set('portfolio/pending-blackrock/2.json',{type:'blackrock_price',updatedAt:new Date().toISOString()});
  await request(a,'1000000',2);
  assert.ok(a.sends.some(x=>x.url.endsWith('/sendPhoto')));
  noHistorical(a,a.renderedSvgs.at(-1));assert.match(a.renderedSvgs.at(-1),/بلک راک\*: صندوق خصوصی اکوکوچ/);
});
