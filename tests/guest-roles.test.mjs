import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {app,startLatest} from './helpers/app-fixture.mjs';

const KEY='portfolio/access-control.json',header={'x-telegram-bot-api-secret-token':'fixture-webhook'},auth={'x-portfolio-sync-secret':'fixture-secondary'};
const state=()=>({approved:['2','3','4'],delegatedAdmins:['3','4'],pending:{'5':{id:'5',first_name:'Requested User'}},users:{},audit:[]});
const msg=(text,id=2)=>({message:{chat:{id,type:'private'},from:{id},text}});
const cb=(data,id=3,chat=id)=>({callback_query:{id:'fixture-callback',from:{id},data,message:{chat:{id:chat,type:'private'}}}});
const messages=a=>a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));
async function fixture(options){const a=await app(options);a.store.set(KEY,state());a.store.set('portfolio/latest.json',a.payload);return a;}
const requestId=a=>JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
async function complete(a,id=requestId(a)){
  const snapshot={...a.payload,assets:{...a.assets,'بلک راک':15},updated_at:new Date().toISOString()};
  a.store.set('portfolio/latest.json',snapshot);
  return a.request('POST',{complete:'latest-allocation'},{request_id:id,ok:true,snapshot_updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},auth);
}

test('existing ordinary approvals become chart-only guests without changing membership or exposing any report through aliases',async()=>{
  const a=await fixture(),before=JSON.stringify(a.store.get(KEY));
  for(const command of ['/start','/help','/menu','/assets','دارایی‌ها','/status','/gold','/crypto','/cash','دلار نقدی','/latest_allocation','/allocation','/refresh','آخرین ترکیب دارایی','850000']){
    await a.request('POST',{},msg(command),header);
    const reply=messages(a).at(-1);
    assert.match(reply.text,/مهمان/);assert.deepEqual(reply.reply_markup.keyboard,[[{text:'نمودار ترکیب دارایی'}]]);
    assert.doesNotMatch(reply.text,/EcoCoach|بلک راک|Snapshot|تومان|یادداشت|قیمت فعلی|مقدار:|3030/);
  }
  assert.equal(a.dispatches.length,0);assert.equal(a.marketCalls.length,0);
  assert.equal(JSON.stringify(a.store.get(KEY)),before);
  await a.request('POST',{},cb('admin:approve_admin:5',2),header);
  assert.equal(a.store.get(KEY).approved.includes('5'),false);
});

test('role approval is an atomic explicit choice and old approve buttons/commands only open that choice',async()=>{
  for(const role of ['guest','admin']){
    const a=await fixture();await a.request('POST',{},cb('admin:approve_'+role+':5'),header);
    const saved=a.store.get(KEY);
    assert.ok(saved.approved.includes('5'));assert.equal(saved.delegatedAdmins.includes('5'),role==='admin');
    assert.equal(saved.pending['5'],undefined);assert.equal(saved.audit.at(-1).action,'approve_'+role);
    assert.ok(a.writes.find(x=>x.key===KEY).options.ifMatch);
    const notice=messages(a).find(x=>x.chat_id===5);
    assert.equal(notice.reply_markup.keyboard.flat().some(x=>x.text==='پنل مدیریت'),role==='admin');
    await a.request('POST',{},cb('admin:approve_admin:5'),header);
    assert.equal(a.writes.filter(x=>x.key===KEY).length,1);
  }
  for(const legacy of ['access:approve:5','admin:approve:5','/approve 5']){
    const a=await fixture();
    await a.request('POST',{},legacy.startsWith('/')?msg(legacy,3):cb(legacy),header);
    assert.equal(a.store.get(KEY).approved.includes('5'),false);
    const choices=messages(a).at(-1).reply_markup.inline_keyboard.flat().map(x=>x.callback_data);
    assert.ok(choices.includes('admin:approve_guest:5'));assert.ok(choices.includes('admin:approve_admin:5'));
  }
});

test('admins promote guests and demote another admin; owner and self roles stay protected',async()=>{
  const a=await fixture();await a.request('POST',{},cb('admin:grant:2'),header);
  assert.ok(a.store.get(KEY).delegatedAdmins.includes('2'));
  a.store.set('portfolio/pending-blackrock/4.json',{type:'blackrock_price'});
  await a.request('POST',{},cb('admin:demote:4'),header);
  assert.equal(a.store.get(KEY).delegatedAdmins.includes('4'),false);assert.ok(a.store.get(KEY).approved.includes('4'));
  assert.equal(a.store.get('portfolio/pending-blackrock/4.json').type,'none');
  assert.deepEqual(messages(a).find(x=>x.chat_id===4).reply_markup.keyboard,[[{text:'نمودار ترکیب دارایی'}]]);
  const count=a.writes.filter(x=>x.key===KEY).length;
  for(const data of ['admin:demote:1','admin:grant:1','admin:demote:3','admin:grant:3'])await a.request('POST',{},cb(data),header);
  assert.equal(a.writes.filter(x=>x.key===KEY).length,count);
});

test('guest image contains the same group percentages but no total, asset notes or detailed valuation output',async()=>{
  const a=await fixture();const q={...a.assets,...a.ns.MANUAL,'بلک راک':15};
  const data=await a.ns.prepareAllocation(q,null,{guest:true});
  const normal=a.ns.buildAllocationPieSvg(data,a.payload),guest=a.ns.buildAllocationPieSvg(data,a.payload,{guest:true});
  assert.match(normal,/ارزش کل گزارش/);
  assert.doesNotMatch(guest,/ارزش کل|تومان|بلک راک|یادداشت|طلب از مامان|3030|EcoCoach/);
  for(const group of a.ns.allocationGroups(data.vals,data.total)){
    assert.ok(guest.includes('>'+group.label+'</text>'));
    if(group.value>0)assert.ok(guest.includes('data-category="'+group.category+'" data-percentage="'+group.percentage+'"'));
  }
  for(const format of ['text','image','chart']){
    const report=await a.ns.latestAllocationReport(q,100000,format,a.payload,{guest:true});
    assert.equal(report.total,undefined);assert.equal(report.messages,undefined);assert.equal(report.captionFootnotes,undefined);
    const metadata=await sharp(report.png).metadata();assert.equal(metadata.width,1600);assert.equal(metadata.height,1160);
  }
});

test('guest fallback delivers a redacted chart after one fresh sync without admin price prompts',async()=>{
  const a=await fixture();await a.request('POST',{},msg('/allocation_chart'),header);
  assert.equal(a.marketCalls.length,0);const id=requestId(a);await complete(a);
  const guestText=messages(a).filter(x=>x.chat_id===2).map(x=>x.text).join('\n');
  assert.doesNotMatch(guestText,/EcoCoach|بلک راک|تعداد:|تومان|یادداشت|تأیید قیمت|1030000/);
  assert.equal(a.store.get('portfolio/latest-allocation/requests/'+id+'.json').status,'completed');
  assert.equal(a.store.get('portfolio/pending-blackrock/2.json').type,'none');
  assert.equal(messages(a).some(x=>x.chat_id!==2),false);
  assert.equal(a.dispatches.length,1);
  assert.equal(a.marketCalls.filter(url=>url==='https://ecocoach.net/blackrock-index').length,1);
  const photos=a.sends.filter(x=>x.url.endsWith('/sendPhoto'));assert.equal(photos.length,1);
  assert.equal(photos[0].options.body.get('chat_id'),'2');assert.equal(photos[0].options.body.get('caption'),'نمودار درصد ترکیب دارایی');
  assert.deepEqual(JSON.parse(photos[0].options.body.get('reply_markup')).keyboard,[[{text:'نمودار ترکیب دارایی'}]]);
});

test('demotion during image/text preparation blocks sensitive sends and old selection callbacks',async()=>{
  for(const format of ['image','text','chart']){
    let changed=false;
    const a=await fixture({beforeMarketFetch:(url,store)=>{
      if(!changed){changed=true;store.get(KEY).delegatedAdmins=['4'];}
    }});
    await startLatest(a,{id:3,format:format==='chart'?'image':format});
    const id=requestId(a),key='portfolio/latest-allocation/requests/'+id+'.json';
    a.store.get(key).report_format=format;a.store.get(key).blackRockPriceRial=8500000;
    a.sends.length=0;await complete(a);
    assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
    assert.equal(messages(a).some(x=>/گزارش تفصیلی|تعداد:|بلک راک|تومان|یادداشت/.test(x.text)),false);
  }
  const a=await fixture();await a.request('POST',{},msg('/latest_allocation',3),header);
  const selection=messages(a).at(-1).reply_markup.inline_keyboard[0][0].callback_data;
  a.store.get(KEY).delegatedAdmins=['4'];await a.request('POST',{},cb(selection),header);
  assert.equal(a.dispatches.length,0);
});

test('retired guest-price buttons cannot resume any legacy request or create admin price input',async()=>{
  for(const scenario of ['current','expired','replaced','invalid','revoked']){
    const a=await fixture();await a.request('POST',{},msg('/allocation_chart'),header);await complete(a);
    const id=requestId(a),record=a.store.get('portfolio/latest-allocation/requests/'+id+'.json');
    record.status='awaiting_price';record.ecoCoach_quantity=15;
    if(scenario==='expired')record.requested_at='2020-01-01T00:00:00Z';
    if(scenario==='invalid')record.requested_at='invalid';
    if(scenario==='replaced')a.store.set('portfolio/latest-allocation/active/2.json',{request_id:'different'});
    if(scenario==='revoked')a.store.get(KEY).approved=['3','4'];
    await a.request('POST',{},cb('admin:guest_price:'+id),header);
    assert.notEqual(a.store.get('portfolio/pending-blackrock/3.json')?.type,'guest_blackrock_price');
    assert.equal(a.dispatches.length,1);
    assert.equal(messages(a).some(x=>x.chat_id===3&&/EcoCoach|قیمت فعلی|تعداد:/.test(x.text)),false);
  }
});
