import test from 'node:test';
import assert from 'node:assert/strict';
import {app,startLatest} from './helpers/app-fixture.mjs';

const KEY='portfolio/access-control.json',DAY=86400000;
const headers={'x-telegram-bot-api-secret-token':'fixture-webhook'},auth={'x-portfolio-sync-secret':'fixture-secondary'};
let update=1000;
const messages=a=>a.sends.filter(x=>x.url.endsWith('/sendMessage')).map(x=>JSON.parse(x.options.body));
const own=(a,id)=>messages(a).filter(x=>String(x.chat_id)===String(id));
const alerts=a=>messages(a).filter(x=>x.text.startsWith('<b>فعالیت کاربر</b>'));
const stamp=value=>new Date(value).toISOString();
const term=(approved,expires)=>({approved_at:stamp(approved),expires_at:stamp(expires),source:'approval'});
async function fixture(options={}){
  const clock={value:Date.now()+10000};
  const a=await app({...options,now:()=>clock.value});
  const state={approved:['2','3','4'],delegatedAdmins:['3'],financialAdvisors:['2'],pending:{},users:{},audit:[],
    accessPolicy:{version:1,activated_at:stamp(clock.value-2*DAY)},
    accessTerms:{'2':term(clock.value-2*DAY,clock.value+5*DAY),'4':term(clock.value-2*DAY,clock.value+5*DAY)}};
  a.store.set(KEY,state);a.payload.updated_at=stamp(clock.value);a.store.set('portfolio/latest.json',a.payload);
  return {...a,clock,state};
}
const command=(a,text,id=2,updateId=++update,extra={})=>a.request('POST',{}, {update_id:updateId,message:{message_id:updateId,chat:{id,type:'private'},from:{id,first_name:'Synthetic <User>',username:'fixture'},text,...extra}},headers);
const click=(a,data,id=1,callbackId='callback-'+(++update))=>a.request('POST',{}, {update_id:++update,callback_query:{id:callbackId,data,from:{id},message:{chat:{id,type:'private'}}}},headers);
const configure=(a,body={},authentication=auth)=>a.request('POST',{configure:'access-expiry'},body,authentication);
async function complete(a){
  const id=JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
  a.store.get('portfolio/latest-allocation/requests/'+id+'.json').blackRockPriceRial=8500000;
  const snapshot={...a.payload,assets:{...a.assets,'بلک راک':15},updated_at:stamp(a.clock.value)};
  a.store.set('portfolio/latest.json',snapshot);
  return a.request('POST',{complete:'latest-allocation'},{request_id:id,ok:true,snapshot_updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},auth);
}

test('new guest/advisor approvals get exactly seven days; admin approvals remain unlimited without expiry notices',async()=>{
  for(const role of ['guest','advisor','admin']){
    const a=await fixture();a.state.pending['5']={id:'5',first_name:'Applicant'};
    await click(a,'admin:approve_'+role+':5');
    const state=await a.ns.loadAccessState({strict:true});assert.equal(a.ns.hasBotAccess('5',state),true);
    if(role==='admin')assert.equal(state.accessTerms['5'],undefined);
    else{
      assert.equal(state.accessTerms['5'].approved_at,stamp(a.clock.value));
      assert.equal(Date.parse(state.accessTerms['5'].expires_at)-a.clock.value,7*DAY);
      assert.equal(own(a,5).length,1);assert.doesNotMatch(own(a,5)[0].text,/انقضا|هفته|روز|تمدید/);
    }
    a.clock.value+=8*DAY;
    assert.equal(a.ns.hasBotAccess('5',state),role==='admin');
  }
});

test('access ends exactly at the deadline for guests and advisors; owner/admin access never expires',async()=>{
  const a=await fixture(),deadline=Date.parse(a.state.accessTerms['2'].expires_at);
  for(const uid of ['2','4']){
    a.clock.value=deadline-1;assert.equal(a.ns.hasBotAccess(uid,a.state),true);
    a.clock.value=deadline;assert.equal(a.ns.hasBotAccess(uid,a.state),false);assert.equal(a.ns.canReadReports(uid,a.state),false);
  }
  a.state.accessTerms['3']=term(deadline-9*DAY,deadline-DAY);a.clock.value+=100*DAY;
  for(const uid of ['1','3'])assert.equal(a.ns.hasBotAccess(uid,a.state),true);
});

test('expiry and old callbacks are silent to affected users and trigger no report work',async()=>{
  const a=await fixture();a.clock.value+=5*DAY;
  for(const uid of [2,4])for(const text of ['/assets','/help','/admin','/allocation_chart','850000'])await command(a,text,uid);
  await click(a,'allocation:pick:00000000-0000-4000-8000-000000000000:text',2);
  await click(a,'admin:expiry:0',4);
  assert.equal(own(a,2).length,0);assert.equal(own(a,4).length,0);
  assert.equal(a.marketCalls.length,0);assert.equal(a.dispatches.length,0);
  const answers=a.sends.filter(x=>x.url.endsWith('/answerCallbackQuery')).map(x=>JSON.parse(x.options.body));
  assert.ok(answers.length===2&&answers.every(x=>x.text===''));
  assert.ok(alerts(a).length>0);assert.ok(alerts(a).every(x=>x.text.includes('غیرفعال')));
});

test('legacy activation recovers approval history and grants a stable seven-day fallback only for missing dates',async()=>{
  const a=await fixture();delete a.state.accessPolicy;delete a.state.accessTerms;
  a.state.audit=[{at:stamp(a.clock.value-9*DAY),action:'approve_guest',target_id:'4',actor_id:'1'},
    {at:stamp(a.clock.value-2*DAY),action:'approve_advisor',target_id:'2',actor_id:'1'}];
  const before=JSON.stringify(a.state);
  assert.equal((await configure(a,{},{})).code,401);
  a.state.approved.push('6');
  const dry=await configure(a);assert.equal(dry.code,200);assert.equal(dry.data.applied,false);
  assert.equal(dry.data.activation_date_fallback_count,1);assert.equal(dry.data.expired_non_admin_count,1);
  assert.equal(a.writes.length,0);assert.equal(a.state.accessPolicy,undefined);
  const applied=await configure(a,{apply:true});assert.equal(applied.data.changed,true);
  const stored=a.store.get(KEY);assert.equal(stored.accessTerms['2'].expires_at,stamp(a.clock.value+5*DAY));
  assert.equal(stored.accessTerms['4'].expires_at,stamp(a.clock.value-2*DAY));
  assert.equal(stored.accessTerms['6'].expires_at,stamp(a.clock.value+7*DAY));
  assert.equal(stored.accessTerms['3'],undefined);assert.deepEqual(stored.delegatedAdmins,['3']);
  const written=JSON.stringify(stored);a.clock.value+=DAY;
  assert.equal((await configure(a,{apply:true})).data.changed,false);assert.equal(JSON.stringify(a.store.get(KEY)),written);
  const health=await a.request('GET',{data:'access-health'},{},auth);
  assert.equal(health.data.access_expiry_configured,true);assert.equal(health.data.persisted_expiry_count,3);
  assert.equal(health.data.tracked_non_admin_count,3);assert.equal(health.data.expired_non_admin_count,1);
  assert.equal(a.sends.length,0);assert.ok(a.writes.every(x=>x.key===KEY&&x.options.ifMatch));
  assert.ok(before.includes('approve_guest'));
});

test('missing and corrupt expiry metadata cannot grant access or be repaired by reading it',async()=>{
  const a=await fixture();
  for(const value of [null,{},'bad',{approved_at:1,expires_at:2},term(a.clock.value+DAY,a.clock.value+2*DAY)]){
    a.state.accessTerms['2']=value;assert.equal(a.ns.hasBotAccess('2',a.state),false);
  }
  delete a.state.accessTerms['2'];delete a.state.accessPolicy;
  assert.equal(a.ns.hasBotAccess('2',a.state),false);
  a.state.accessTerms=[];
  await assert.rejects(a.ns.loadAccessState({strict:true}),/unavailable/);assert.equal(a.writes.length,0);
});

test('monitor shows remaining time, expired status and unlimited admins; extension controls are admin-only',async()=>{
  const a=await fixture();a.state.accessTerms['4']=term(a.clock.value-9*DAY,a.clock.value-2*DAY);
  await click(a,'admin:expiry:0');const panel=own(a,1).at(-1);
  assert.equal(panel.parse_mode,'HTML');assert.match(panel.text,/زمان باقی‌مانده|منقضی|بدون محدودیت زمانی/);
  assert.match(panel.text,/پایان دسترسی: <b>[۰-۹]+\/[۰-۹]+\/[۰-۹]+/);
  const data=panel.reply_markup.inline_keyboard.flat().map(x=>x.callback_data);
  for(const days of [1,3,7])assert.ok(data.includes('admin:extend:2:'+days));
  assert.equal(data.some(x=>x.startsWith('admin:extend:4:')),false);
  assert.equal(a.store.get(KEY).approved.includes('4'),false);
  assert.equal(data.some(x=>/^admin:extend:(1|3):/.test(x)),false);
  const before=JSON.stringify(a.state);await click(a,'admin:extend:2:7',2);
  assert.equal(JSON.stringify(a.state),before);
});

test('extensions add 1/3/7 days to active expiry; removed expired users require approval again',async()=>{
  for(const days of [1,3,7])for(const actor of [1,3]){
    const a=await fixture();const deadline=Date.parse(a.state.accessTerms['2'].expires_at);
    await click(a,'admin:extend:2:'+days,actor);
    assert.equal(Date.parse(a.store.get(KEY).accessTerms['2'].expires_at),deadline+days*DAY);
    assert.deepEqual(a.store.get(KEY).financialAdvisors,['2']);assert.equal(own(a,2).length,0);
    const b=await fixture();b.state.accessTerms['2']=term(b.clock.value-9*DAY,b.clock.value-2*DAY);
    await click(b,'admin:extend:2:'+days,actor);
    assert.equal(b.store.get(KEY).accessTerms['2'],undefined);
    assert.equal(b.store.get(KEY).approved.includes('2'),false);
    assert.equal(own(b,2).length,0);
  }
});

test('extensions reject unsupported durations/admins/revoked users and duplicate callbacks do not add time twice',async()=>{
  for(const data of ['admin:extend:1:7','admin:extend:3:7','admin:extend:99:7','admin:extend:2:2','admin:extend:2:01']){
    const a=await fixture(),before=JSON.stringify(a.state);await click(a,data);
    assert.equal(JSON.stringify(a.store.get(KEY)),before,data);
  }
  const a=await fixture();await click(a,'admin:extend:2:3',1,'same-extension');
  const expires=a.store.get(KEY).accessTerms['2'].expires_at;
  await click(a,'admin:extend:2:3',1,'same-extension');assert.equal(a.store.get(KEY).accessTerms['2'].expires_at,expires);
  const b=await fixture({beforeWrite:(key,_value,_options,store)=>{if(key===KEY)store.get(KEY).approved.push('9');}});
  const previous=b.state.accessTerms['2'].expires_at;await click(b,'admin:extend:2:7');
  assert.equal(b.store.get(KEY).accessTerms['2'].expires_at,previous);assert.equal(own(b,2).length,0);
});

test('promotion exempts a user, demotion starts a week, and guest/advisor switches do not refresh expiry',async()=>{
  const a=await fixture(),deadline=a.state.accessTerms['2'].expires_at;
  await click(a,'admin:guest:2');assert.equal(a.store.get(KEY).accessTerms['2'].expires_at,deadline);
  await click(a,'admin:advisor:2');assert.equal(a.store.get(KEY).accessTerms['2'].expires_at,deadline);
  await click(a,'admin:grant:2');a.clock.value+=20*DAY;
  assert.equal(a.ns.hasBotAccess('2',await a.ns.loadAccessState({strict:true})),true);
  await click(a,'admin:demote:2');assert.equal(Date.parse(a.store.get(KEY).accessTerms['2'].expires_at),a.clock.value+7*DAY);
});

test('expiry blocks pending OneDrive completions and price retrieval for every report format, including guests',async()=>{
  for(const uid of [2,4])for(const format of uid===4?['chart']:['text','image','chart']){
    const a=await fixture();
    if(format==='chart')await command(a,'/allocation_chart',uid);else await startLatest(a,{id:uid,format});
    a.clock.value+=5*DAY;a.sends.length=0;await complete(a);
    assert.equal(own(a,uid).length,0);assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);assert.equal(a.marketCalls.length,0);
  }
});

test('expiry during market retrieval or between text chunks prevents all subsequent user delivery',async()=>{
  for(const uid of [2,4])for(const format of uid===4?['chart']:['text','image','chart']){
    let a;a=await fixture({beforeMarketFetch:()=>{a.state.accessTerms[String(uid)]=term(a.clock.value-DAY,a.clock.value);}});
    if(format==='chart')await command(a,'/allocation_chart',uid);else await startLatest(a,{id:uid,format});
    a.sends.length=0;await complete(a);assert.equal(own(a,uid).length,0);assert.equal(a.sends.some(x=>x.url.endsWith('/sendPhoto')),false);
  }
  let a;a=await fixture({telegramReply:call=>{
    if(call.url.endsWith('/sendMessage')&&JSON.parse(call.options.body).text.startsWith('<b>گزارش تفصیلی'))a.state.accessTerms['2']=term(a.clock.value-DAY,a.clock.value);
    return null;
  }});
  await startLatest(a,{id:2,format:'text'});a.sends.length=0;await complete(a);assert.equal(own(a,2).length,1);
});

test('command and Persian button alerts reach current admins only, with escaped identities and no raw inputs',async()=>{
  const a=await fixture();
  for(const text of ['/assets','دارایی‌ها','/cash_dollar','/unknown a-secret-argument'])await command(a,text);
  assert.equal(alerts(a).length,8);assert.deepEqual([...new Set(alerts(a).map(x=>x.chat_id))].sort(),[1,3]);
  assert.ok(alerts(a).every(x=>x.parse_mode==='HTML'&&x.text.includes('Synthetic &lt;User&gt;')&&x.text.includes('زمان: <b>')));
  assert.equal(alerts(a).some(x=>x.text.includes('a-secret-argument')),false);
  assert.equal(alerts(a).filter(x=>x.text.includes('/assets')).length,4);
  const before=alerts(a).length;await command(a,'850000');await command(a,'free text with a-secret-argument');
  await command(a,'/assets',1);await command(a,'/assets',3);assert.equal(alerts(a).length,before);
});

test('notifications are deduplicated per update and recipient without changing access or cleaning admin panels',async()=>{
  const a=await fixture();await click(a,'admin:expiry:0');
  const panel=JSON.stringify(a.store.get('portfolio/temporary-replies/1.json')),access=JSON.stringify(a.store.get(KEY));
  const id=++update;await Promise.all([command(a,'/help',2,id),command(a,'/help',2,id)]);
  await command(a,'/help',2,id);assert.equal(alerts(a).length,2);
  assert.equal(JSON.stringify(a.store.get('portfolio/temporary-replies/1.json')),panel);
  assert.equal(JSON.stringify(a.store.get(KEY)),access);
  assert.ok(a.writes.filter(x=>x.key.startsWith('portfolio/command-activity/')).every(x=>x.options.allowOverwrite===false||x.options.ifMatch));
});

test('notification retry/failure and concurrent admin demotion do not expose activity or block user reports',async()=>{
  let failed=false;
  const a=await fixture({telegramReply:call=>{
    if(call.url.endsWith('/sendMessage')&&JSON.parse(call.options.body).text.startsWith('<b>فعالیت کاربر</b>')&&!failed){failed=true;return {ok:false,status:500};}return null;
  }});
  await command(a,'/help');assert.equal(alerts(a).length,3);assert.ok(own(a,2).length>0);
  const b=await fixture({beforeWrite:(key,_value,_options,store)=>{if(key.endsWith('/3.json')&&key.startsWith('portfolio/command-activity/'))store.get(KEY).delegatedAdmins=[];}});
  await command(b,'/help');assert.deepEqual(alerts(b).map(x=>x.chat_id),[1]);
  const c=await fixture({readError:key=>key.startsWith('portfolio/command-activity/')});
  await command(c,'/help');assert.equal(alerts(c).length,0);assert.ok(own(c,2).length>0);
});

test('spoofed webhooks, groups and mismatched identities cannot generate command alerts',async()=>{
  const a=await fixture();const body={update_id:++update,message:{chat:{id:2,type:'private'},from:{id:2},text:'/assets'}};
  assert.equal((await a.request('POST',{},body,{})).code,401);
  await command(a,'/assets',2,++update,{chat:{id:2,type:'group'}});
  await command(a,'/assets',2,++update,{from:{id:9}});
  assert.equal(alerts(a).length,0);
});

test('report-selection callbacks and active guest commands notify admins with the selected command',async()=>{
  const a=await fixture();await command(a,'/latest_allocation');
  const data=own(a,2).at(-1).reply_markup.inline_keyboard[0][1].callback_data;
  await click(a,data,2);await command(a,'نمودار ترکیب دارایی',4);
  assert.equal(alerts(a).filter(x=>x.text.includes('گزارش متنی')).length,2);
  assert.equal(alerts(a).filter(x=>x.text.includes('/allocation_chart')&&x.text.includes('مهمان')).length,2);
  assert.equal(a.dispatches.length,2);
});

test('failed notification receipts retry on replay without resending successful recipients',async()=>{
  let unavailable=true;
  const a=await fixture({telegramReply:call=>{
    if(call.url.endsWith('/sendMessage')){
      const b=JSON.parse(call.options.body);
      if(unavailable&&b.chat_id===1&&b.text.startsWith('<b>فعالیت کاربر</b>'))return {ok:false,status:500};
    }
    return null;
  }});
  const id=++update;await command(a,'/help',2,id);
  assert.equal(a.store.get('portfolio/command-activity/'+id+'/1.json').status,'failed');
  assert.equal(a.store.get('portfolio/command-activity/'+id+'/3.json').status,'delivered');
  unavailable=false;await command(a,'/help',2,id);
  assert.equal(a.store.get('portfolio/command-activity/'+id+'/1.json').status,'delivered');
  assert.equal(alerts(a).filter(x=>x.chat_id===1).length,3);assert.equal(alerts(a).filter(x=>x.chat_id===3).length,1);
});

test('monitor pagination and conditional activation conflicts preserve the latest access state',async()=>{
  const a=await fixture();a.state.approved.push(...Array.from({length:12},(_,i)=>String(i+10)));
  await click(a,'admin:expiry:1');const panel=own(a,1).at(-1);
  assert.match(panel.text,/صفحه 2/);assert.ok(panel.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==='admin:expiry:0'));
  const b=await fixture({beforeWrite:(key,_value,_options,store)=>{if(key===KEY)store.get(KEY).pending['8']={id:'8'};}});
  delete b.state.accessPolicy;delete b.state.accessTerms;
  const result=await configure(b,{apply:true});assert.equal(result.code,409);
  assert.equal(b.store.get(KEY).accessPolicy,undefined);assert.ok(b.store.get(KEY).pending['8']);assert.equal(b.sends.length,0);
});

test('expired users can explicitly request renewed approval without expiry warnings',async()=>{
  const a=await fixture();a.clock.value+=5*DAY;await command(a,'/start');
  assert.ok(a.store.get(KEY).pending['2']);assert.equal(own(a,2).length,1);assert.doesNotMatch(own(a,2)[0].text,/منقضی|تمدید|هفته/);
  await click(a,'admin:approve_advisor:2');assert.equal(Date.parse(a.store.get(KEY).accessTerms['2'].expires_at),a.clock.value+7*DAY);
});


test('scheduled removal purges expired membership, roles, pending requests and profiles without Telegram messages',async()=>{
  const a=await fixture();a.state.users['2']={first_name:'Removed'};a.state.pending['2']={id:'2'};
  a.state.accessTerms['3']=term(a.clock.value-10*DAY,a.clock.value-DAY);a.clock.value+=5*DAY;
  assert.equal((await a.request('POST',{maintain:'expired-access'},{},{})).code,401);
  const result=await a.request('POST',{maintain:'expired-access'},{},auth);assert.equal(result.code,200);
  const stored=a.store.get(KEY);assert.deepEqual(stored.approved,['3']);assert.deepEqual(stored.financialAdvisors,[]);
  assert.deepEqual(stored.delegatedAdmins,['3']);assert.equal(stored.users['2'],undefined);assert.equal(stored.pending['2'],undefined);
  assert.equal(stored.accessTerms['2'],undefined);assert.ok(stored.expiredUsers['2']);assert.ok(stored.expiredUsers['4']);
  assert.equal(a.sends.length,0);const writes=a.writes.length;
  await a.request('POST',{maintain:'expired-access'},{},auth);assert.equal(a.writes.length,writes);
  await command(a,'/assets');assert.equal(own(a,2).length,0);
  await command(a,'/start');assert.ok(a.store.get(KEY).pending['2']);
  await click(a,'admin:approve_advisor:2');assert.equal(a.store.get(KEY).expiredUsers['2'],undefined);
  assert.equal(a.ns.hasBotAccess('2',await a.ns.loadAccessState({strict:true})),true);
});

test('a concurrent extension wins over stale cleanup and cannot be overwritten',async()=>{
  let changed=false;let a;
  a=await fixture({beforeWrite:(key,_value,_options,store)=>{
    if(key===KEY&&!changed){changed=true;store.get(KEY).accessTerms['2'].expires_at=stamp(a.clock.value+DAY);}
  }});
  a.state.accessTerms['2']=term(a.clock.value-9*DAY,a.clock.value-DAY);
  await a.request('POST',{maintain:'expired-access'},{},auth);
  assert.equal(a.store.get(KEY).approved.includes('2'),true);assert.equal(a.store.get(KEY).expiredUsers?.['2'],undefined);
});
