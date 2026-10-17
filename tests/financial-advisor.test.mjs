import test from 'node:test';
import assert from 'node:assert/strict';
import {app,startLatest} from './helpers/app-fixture.mjs';

const ACCESS_POLICY_STARTED_AT=new Date().toISOString();

const KEY='portfolio/access-control.json',headers={'x-telegram-bot-api-secret-token':'fixture-webhook'},auth={'x-portfolio-sync-secret':'fixture-secondary'};
const state=()=>({accessPolicy:{version:1,activated_at:ACCESS_POLICY_STARTED_AT},approved:['2','3','4'],delegatedAdmins:['3'],financialAdvisors:['2'],pending:{'5':{id:'5',first_name:'Fixture Applicant'}},users:{},audit:[]});
const messages=a=>a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));
const request=(a,text,id=2)=>a.request('POST',{}, {message:{chat:{id,type:'private'},from:{id},text}},headers);
const click=(a,data,id=3,chat=id,type='private')=>a.request('POST',{}, {callback_query:{id:'fixture',from:{id},data,message:{chat:{id:chat,type}}}},headers);
const id=a=>JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
async function fixture(options){const a=await app(options);a.store.set(KEY,state());a.store.set('portfolio/latest.json',a.payload);return a;}
async function complete(a){
  const snapshot={...a.payload,assets:{...a.assets,'بلک راک':15},updated_at:new Date().toISOString()};a.store.set('portfolio/latest.json',snapshot);
  return a.request('POST',{complete:'latest-allocation'},{request_id:id(a),ok:true,snapshot_updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},auth);
}

test('new approval offers advisor role; only admins receive access requests and can approve it',async()=>{
  const a=await fixture();await request(a,'/start',6);
  const notices=messages(a).filter(x=>x.reply_markup?.inline_keyboard);
  assert.deepEqual(notices.map(x=>String(x.chat_id)).sort(),['1','3']);
  for(const notice of notices)assert.ok(notice.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='admin:approve_advisor:6'));
  await click(a,'admin:approve_advisor:5');
  assert.ok(a.store.get(KEY).approved.includes('5'));assert.deepEqual(a.store.get(KEY).financialAdvisors,['2','5']);
  assert.deepEqual(a.store.get(KEY).delegatedAdmins,['3']);assert.equal(a.store.get(KEY).pending['5'],undefined);
  assert.equal(a.store.get(KEY).audit.at(-1).action,'approve_advisor');
  assert.ok(a.writes.filter(x=>x.key===KEY).every(x=>x.options.ifMatch));
  const notice=messages(a).find(x=>x.chat_id===5);assert.match(notice.text,/مشاور مالی/);
  assert.ok(notice.reply_markup.keyboard.flat().some(x=>x.text==='آخرین ترکیب دارایی'));
  assert.equal(notice.reply_markup.keyboard.flat().some(x=>x.text==='پنل مدیریت'),false);
});

test('admins assign, promote, demote and revoke advisors without overlapping roles or changing owner/self roles',async()=>{
  const a=await fixture();await click(a,'admin:advisor:4');
  assert.deepEqual(a.store.get(KEY).financialAdvisors,['2','4']);
  await click(a,'admin:grant:4');assert.deepEqual(a.store.get(KEY).financialAdvisors,['2']);assert.ok(a.store.get(KEY).delegatedAdmins.includes('4'));
  await click(a,'admin:advisor:4');assert.equal(a.store.get(KEY).delegatedAdmins.includes('4'),false);
  await click(a,'admin:guest:4');assert.deepEqual(a.store.get(KEY).financialAdvisors,['2']);assert.ok(a.store.get(KEY).approved.includes('4'));
  await click(a,'admin:advisor:4');await click(a,'admin:confirm_revoke:4');
  assert.equal(a.store.get(KEY).approved.includes('4'),false);assert.deepEqual(a.store.get(KEY).financialAdvisors,['2']);
  const count=a.writes.filter(x=>x.key===KEY).length;
  for(const data of ['admin:advisor:1','admin:guest:1','admin:advisor:3','admin:guest:3','admin:advisor:5'])await click(a,data);
  assert.equal(a.writes.filter(x=>x.key===KEY).length,count);
  await click(a,'admin:admins:0');
  const panel=messages(a).at(-1);assert.match(panel.text,/مشاور مالی/);
  assert.ok(panel.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==='admin:guest:2'));
  assert.ok(panel.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==='admin:grant:2'));
});

test('advisor has report buttons and report commands only; all admin actions, status and forged callbacks are denied',async()=>{
  const a=await fixture();await request(a,'/start');
  const labels=messages(a).at(-1).reply_markup.keyboard.flat().map(x=>x.text);
  for(const label of ['آخرین ترکیب دارایی','دارایی‌ها','رمزارز','دلار نقدی','نمودار ترکیب دارایی'])assert.ok(labels.includes(label));
  assert.equal(labels.includes('پنل مدیریت'),false);assert.equal(labels.includes('وضعیت'),false);
  assert.doesNotMatch(messages(a).at(-1).text,/\/status/);
  for(const command of ['/assets','/crypto','/gold_and_other_precious_metals','/cash_dollar']){
    await request(a,command);assert.doesNotMatch(messages(a).at(-1).text,/فقط نمودار درصد/);
    assert.match(messages(a).at(-1).text,command==='/assets'?/دارایی‌های پرتفوی/:/گزارش تفصیلی/);
  }
  const before=JSON.stringify(a.store.get(KEY)),markets=a.marketCalls.length;
  for(const command of ['/admin','پنل مدیریت','/users','/approve 5','/revoke 4','/status','وضعیت']){
    await request(a,command);assert.doesNotMatch(messages(a).at(-1).text,/ذخیره‌سازی دسترسی:|کاربران مجاز:|آخرین Snapshot/);
  }
  for(const callback of ['admin:status','admin:users:0','admin:pending:0','admin:storage_check','admin:approve_advisor:5','admin:advisor:4','admin:grant:2'])await click(a,callback,2);
  assert.equal(JSON.stringify(a.store.get(KEY)),before);assert.equal(a.marketCalls.length,markets);assert.equal(a.dispatches.length,0);
});

test('advisors receive all fresh report formats with normal manual EcoCoach pricing, never the guest constant',async()=>{
  for(const format of ['image','text','chart']){
    const a=await fixture();
    if(format==='chart')await request(a,'/allocation_chart');else await startLatest(a,{id:2,format});
    await complete(a);
    assert.match(messages(a).at(-1).text,/قیمت فعلی هر واحد صندوق بلک راک/);
    assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
    await request(a,'850000');assert.equal(a.dispatches.length,2);
    assert.equal(a.store.get('portfolio/latest-allocation/requests/'+id(a)+'.json').blackRockPriceRial,8500000);
    await complete(a);
    if(format==='text'){
      assert.ok(messages(a).some(x=>/ارزش کل گزارش:/.test(x.text)));
      assert.ok(messages(a).some(x=>/یادداشت دارایی‌ها/.test(x.text)));
      assert.match(messages(a).at(-1).text,/درصد گروه‌های دارایی/);
    }else{
      const photo=a.sends.find(x=>x.url.endsWith('/sendPhoto'));assert.ok(photo);
      assert.equal(photo.options.body.get('chat_id'),'2');assert.notEqual(photo.options.body.get('caption'),'نمودار درصد ترکیب دارایی');
    }
  }
});

test('demotion/revocation during price retrieval blocks detailed reports prepared for an advisor',async()=>{
  for(const format of ['image','text','chart']){
    const a=await fixture({beforeMarketFetch:(url,store)=>{store.get(KEY).financialAdvisors=[];}});
    if(format==='chart')await request(a,'/allocation_chart');else await startLatest(a,{id:2,format});
    a.store.get('portfolio/latest-allocation/requests/'+id(a)+'.json').blackRockPriceRial=8500000;
    a.sends.length=0;await complete(a);
    assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
    assert.equal(messages(a).some(x=>/ارزش کل|یادداشت|بلک راک/.test(x.text)),false);
  }
});

test('stale advisor callbacks and forged cross-chat/group selections cannot retrieve reports',async()=>{
  const a=await fixture();await request(a,'/latest_allocation');
  const data=messages(a).at(-1).reply_markup.inline_keyboard[0][0].callback_data;
  await click(a,data,2,3);await click(a,data,2,2,'group');
  assert.equal(a.dispatches.length,0);
  a.store.get(KEY).financialAdvisors=[];await click(a,data,2);
  assert.equal(a.dispatches.length,0);
  const b=await fixture();b.store.get(KEY).approved=['3','4'];await request(b,'/assets');
  assert.equal(b.marketCalls.length,0);assert.doesNotMatch(messages(b).at(-1).text,/دارایی‌های پرتفوی/);
});

test('concurrent access changes reject advisor assignments instead of overwriting newer permissions',async()=>{
  const a=await fixture({compressAccessReads:true,beforeWrite:(key,value,options,store)=>{
    if(key===KEY)store.set(KEY,{...store.get(KEY),delegatedAdmins:[]});
  }});
  await click(a,'admin:advisor:4');
  assert.equal(a.writes.filter(x=>x.key===KEY).length,0);assert.deepEqual(a.store.get(KEY).financialAdvisors,['2']);
  assert.equal(messages(a).some(x=>x.chat_id===4),false);
});

test('private role diagnostics show advisor counts without user IDs and reject unauthenticated callers',async()=>{
  const a=await fixture();assert.equal((await a.request('GET',{data:'access-health'})).code,401);
  const response=await a.request('GET',{data:'access-health'}, {},auth);
  assert.equal(response.data.financial_advisor_count,1);assert.equal(response.data.guest_count,1);
  assert.equal(response.data.advisor_reports_only,true);assert.equal(response.data.financialAdvisors,undefined);
});


test('a status reply prepared for an admin is blocked if the user becomes an advisor before delivery',async()=>{
  let a;
  a=await fixture({readError:key=>{
    if(key==='portfolio/latest.json'){
      a.store.get(KEY).delegatedAdmins=[];a.store.get(KEY).financialAdvisors=['2','3'];
    }
    return false;
  }});
  await request(a,'/status',3);
  assert.equal(messages(a).length,0);
});
