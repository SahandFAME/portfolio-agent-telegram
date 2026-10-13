import test from 'node:test';
import assert from 'node:assert/strict';
import {app,startLatest} from './helpers/app-fixture.mjs';

const KEY='portfolio/access-control.json';
const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const message=(text,id=1,type='private')=>({message:{chat:{id,type},from:{id},text}});
const callback=(data,id=1,type='private',chatId=id)=>({callback_query:{id:'synthetic-callback',from:{id},data,message:{chat:{id:chatId,type}}}});
const method=call=>call.url.split('/').at(-1);
const bodies=a=>a.sends.filter(x=>method(x)==='sendMessage').map(x=>JSON.parse(x.options.body));
const callbacks=a=>a.sends.filter(x=>method(x)==='answerCallbackQuery').map(x=>JSON.parse(x.options.body));
const changes=a=>a.writes.filter(x=>x.key===KEY);
const state=()=>({approved:['2','3'],pending:{'5':{id:'5',first_name:'Requested User',username:'fixture_user'}},
  delegatedAdmins:['3'],users:{'2':{first_name:'Approved User'},'3':{first_name:'Chosen Admin'}},audit:[]});
async function fixture(options){const a=await app(options);a.store.set(KEY,state());return a;}
async function click(a,data,id=1){return a.request('POST',{},callback(data,id),header);}

test('dashboard button appears only for the owner and currently approved chosen admins',async()=>{
  for(const [id,visible] of [[1,true],[2,false],[3,true]]){
    const a=await fixture();await a.request('POST',{},message('/start',id),header);
    const rows=bodies(a).find(x=>x.chat_id===id).reply_markup.keyboard;
    const keyboard=rows.flat().map(x=>x.text);
    assert.equal(keyboard.includes('پنل مدیریت'),visible);
    if(!visible){assert.deepEqual(rows,[[{text:'نمودار ترکیب دارایی'}]]);continue;}
    assert.ok(keyboard.includes('آخرین ترکیب دارایی'));
    assert.deepEqual(rows[0],[{text:'آخرین ترکیب دارایی'}]);
    assert.equal(rows.at(-1).length,visible?2:1);
    assert.equal(rows.at(-1)[0].text,'راهنما');
    assert.equal(keyboard.filter(label=>label==='آخرین ترکیب دارایی').length,1);
  }
});

test('owner dashboard provides access requests, users, roles, system status and audit controls',async()=>{
  const a=await fixture();await a.request('POST',{},message('پنل مدیریت'),header);
  const dashboard=bodies(a).at(-1);
  assert.match(dashboard.text,/مالک/);
  assert.deepEqual(dashboard.reply_markup.inline_keyboard.flat().map(x=>x.callback_data),
    ['admin:users:0','admin:pending:0','admin:status','admin:audit','admin:admins:0','admin:main_menu']);
});

test('chosen admin dashboard includes authorized role management',async()=>{
  const a=await fixture();await a.request('POST',{},message('/admin',3),header);
  const dashboard=bodies(a).at(-1);assert.match(dashboard.text,/مدیر منتخب/);
  assert.equal(dashboard.reply_markup.inline_keyboard.flat().some(x=>x.callback_data.startsWith('admin:admins')),true);
});

test('typing the admin button or command cannot bypass authorization',async()=>{
  for(const text of ['پنل مدیریت','/admin'])for(const id of [2,4]){
    const a=await fixture();await a.request('POST',{},message(text,id),header);
    assert.equal(changes(a).length,0);
    assert.equal(bodies(a).some(x=>x.reply_markup?.inline_keyboard),false);
    assert.match(bodies(a).at(-1).text,/دسترسی مدیریت ندارید/);
  }
});

test('forged callbacks from ordinary users, groups or another private chat are refused',async()=>{
  for(const request of [callback('admin:grant:2',2),callback('admin:grant:2',1,'group'),callback('admin:grant:2',1,'private',3)]){
    const a=await fixture();await a.request('POST',{},request,header);
    assert.equal(changes(a).length,0);assert.equal(bodies(a).length,0);
    assert.match(callbacks(a).at(-1).text,/دسترسی/);
  }
});

test('only the owner can grant dashboard rights to an already approved user',async()=>{
  const a=await fixture();await click(a,'admin:grant:2');
  const saved=a.store.get(KEY);assert.deepEqual(saved.delegatedAdmins,['3','2']);
  assert.deepEqual(saved.approved,['2','3']);
  assert.equal(saved.audit.at(-1).action,'grant');assert.equal(saved.audit.at(-1).actor_id,'1');
  assert.ok(changes(a)[0].options.ifMatch);
  const notice=bodies(a).find(x=>x.chat_id===2);
  assert.match(notice.text,/مدیریت.*فعال/);
  assert.ok(notice.reply_markup.keyboard.flat().some(x=>x.text==='پنل مدیریت'));
});

test('pending and unknown users cannot be made admins before access approval',async()=>{
  for(const id of [5,99]){
    const a=await fixture();await click(a,'admin:grant:'+id);
    assert.equal(changes(a).length,0);assert.deepEqual(a.store.get(KEY).delegatedAdmins,['3']);
  }
});

test('chosen admins cannot change their own role or the owner role',async()=>{
  for(const data of ['admin:grant:3','admin:demote:3','admin:demote:1']){
    const a=await fixture();await click(a,data,3);
    assert.equal(changes(a).length,0);assert.equal(bodies(a).length,0);
    assert.match(callbacks(a).at(-1).text,/مجوزها|وضعیت/);
  }
});

test('owner can remove admin rights while preserving ordinary portfolio access',async()=>{
  const a=await fixture();await click(a,'admin:demote:3');
  assert.deepEqual(a.store.get(KEY).delegatedAdmins,[]);assert.ok(a.store.get(KEY).approved.includes('3'));
  const notice=bodies(a).find(x=>x.chat_id===3);
  assert.match(notice.text,/نقش شما به مهمان تغییر کرد/);
  assert.equal(notice.reply_markup.keyboard.flat().some(x=>x.text==='پنل مدیریت'),false);
  a.sends.length=0;await click(a,'admin:approve_guest:5',3);assert.equal(changes(a).length,1);
  assert.equal(a.store.get(KEY).approved.includes('5'),false);
});

test('chosen admin can approve a pending request and retain all prior users and roles',async()=>{
  const a=await fixture();await click(a,'admin:approve_guest:5',3);
  const saved=a.store.get(KEY);assert.deepEqual(saved.approved,['2','3','5']);
  assert.deepEqual(saved.delegatedAdmins,['3']);assert.equal(saved.pending['5'],undefined);
  assert.equal(saved.users['5'].username,'fixture_user');assert.equal(saved.audit[0].action,'approve_guest');
  assert.match(bodies(a).find(x=>x.chat_id===5).text,/تأیید/);
});

test('chosen admin can reject a pending request without granting access',async()=>{
  const a=await fixture();await click(a,'access:reject:5',3);
  assert.equal(a.store.get(KEY).pending['5'],undefined);assert.deepEqual(a.store.get(KEY).approved,['2','3']);
  assert.equal(a.store.get(KEY).audit.at(-1).action,'reject');
});

test('old approval buttons cannot silently reapprove a revoked user',async()=>{
  const a=await fixture();await click(a,'admin:approve_guest:5');await click(a,'admin:confirm_revoke:5');
  const count=changes(a).length;
  for(const data of ['admin:approve:5','access:approve:5'])await click(a,data);
  assert.equal(changes(a).length,count);assert.equal(a.store.get(KEY).approved.includes('5'),false);
});

test('UI revocation asks for confirmation before changing access',async()=>{
  const a=await fixture();await click(a,'admin:revoke:2',3);
  assert.equal(changes(a).length,0);
  assert.ok(bodies(a).at(-1).reply_markup.inline_keyboard.flat().some(x=>x.callback_data==='admin:confirm_revoke:2'));
  await click(a,'admin:confirm_revoke:2',3);
  assert.deepEqual(a.store.get(KEY).approved,['3']);assert.deepEqual(a.store.get(KEY).delegatedAdmins,['3']);
  a.sends.length=0;await a.request('POST',{},message('دارایی‌ها',2),header);
  assert.match(bodies(a).at(-1).text,/private/);assert.equal(bodies(a).at(-1).reply_markup.remove_keyboard,true);
});

test('configured owner cannot be revoked or demoted by any bot action',async()=>{
  for(const id of [1,3])for(const data of ['admin:revoke:1','admin:confirm_revoke:1','admin:demote:1']){
    const a=await fixture();await click(a,data,id);assert.equal(changes(a).length,0);
  }
  const a=await fixture();await a.request('POST',{},message('/revoke 1'),header);assert.equal(changes(a).length,0);
});

test('chosen admins cannot revoke other chosen admins, including themselves',async()=>{
  const a=await fixture();await click(a,'admin:confirm_revoke:3',3);
  await a.request('POST',{},message('/revoke 3',3),header);assert.equal(changes(a).length,0);
});

test('owner revocation also removes dashboard role and clears pending price interaction',async()=>{
  const a=await fixture();a.store.set('portfolio/pending-blackrock/3.json',{type:'latest_blackrock_price'});
  await click(a,'admin:confirm_revoke:3');
  assert.deepEqual(a.store.get(KEY).approved,['2']);assert.deepEqual(a.store.get(KEY).delegatedAdmins,[]);
  assert.equal(a.store.get('portfolio/pending-blackrock/3.json').type,'none');
  a.sends.length=0;await click(a,'admin:status',3);assert.equal(bodies(a).length,0);
});

test('revoked users cannot receive completion of a previously queued allocation',async()=>{
  const a=await fixture();await startLatest(a,{id:3});
  const id=JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
  await click(a,'admin:confirm_revoke:3');a.sends.length=0;
  const result=await a.request('POST',{complete:'latest-allocation'},
    {request_id:id,ok:true},{'x-portfolio-sync-secret':'fixture-secondary'});
  assert.equal(result.code,200);assert.equal(a.sends.length,0);
});

test('revocation while market prices are loading blocks the image at delivery',async()=>{
  const a=await fixture({beforeMarketFetch:(url,store)=>store.set(KEY,{...state(),approved:['2'],delegatedAdmins:[]})});
  await startLatest(a,{id:3});
  const id=JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
  const key='portfolio/latest-allocation/requests/'+id+'.json';
  a.store.set(key,{...a.store.get(key),blackRockPriceRial:8500000});
  const snapshot={...a.payload,updated_at:new Date().toISOString(),assets:{...a.assets,'بلک راک':15}};
  a.store.set('portfolio/latest.json',snapshot);a.sends.length=0;
  await a.request('POST',{complete:'latest-allocation'},
    {request_id:id,ok:true,snapshot_updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},
    {'x-portfolio-sync-secret':'fixture-secondary'});
  assert.ok(a.marketCalls.length);assert.equal(a.sends.some(x=>method(x)==='sendPhoto'),false);
});

test('revoked admin cannot receive a dashboard list prepared before role removal',async()=>{
  const a=await fixture({telegramReply:call=>{
    if(method(call)==='getChat')a.store.set(KEY,{...state(),delegatedAdmins:[]});return null;
  }});
  await click(a,'admin:users:0',3);assert.equal(bodies(a).length,0);
});

test('new requests reach owner and chosen admins and preserve existing membership',async()=>{
  const a=await fixture();await a.request('POST',{},message('/start',6),header);
  const recipients=bodies(a).filter(x=>x.reply_markup?.inline_keyboard).map(x=>String(x.chat_id));
  assert.deepEqual(recipients,['1','3']);assert.ok(a.store.get(KEY).pending['6']);
  assert.deepEqual(a.store.get(KEY).approved,['2','3']);assert.deepEqual(a.store.get(KEY).delegatedAdmins,['3']);
});

test('system status contains safe diagnostics, freshness and Tehran timestamps without credentials',async()=>{
  const a=await fixture();a.store.set('portfolio/latest.json',a.payload);await click(a,'admin:status');
  const text=bodies(a).at(-1).text;
  assert.match(text,/وضعیت سامانه/);assert.match(text,/به‌روز/);assert.match(text,/تهران/);assert.match(text,/۲۳/);
  assert.doesNotMatch(text,/fixture-(primary|secondary|actions|webhook|bot)|Bearer|BTC/);
});

test('user and request lists are paginated and display names safely as plain text',async()=>{
  const a=await fixture();const s=state();s.approved=Array.from({length:20},(_,i)=>String(i+2));
  s.users['2']={first_name:'<b>Display Name</b>'};a.store.set(KEY,s);await click(a,'admin:users:0');
  const first=bodies(a).at(-1);assert.match(first.text,/<b>Display Name<\/b>/);assert.equal(first.parse_mode,undefined);
  assert.ok(first.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==='admin:users:1'));
  assert.equal(first.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==='admin:revoke:1'),false);
  await click(a,'admin:users:1');assert.match(bodies(a).at(-1).text,/صفحه 2/);
  assert.ok(bodies(a).at(-1).reply_markup.inline_keyboard.flat().some(x=>x.callback_data==='admin:users:0'));
});

test('access audit records role changes and is available to current admins only',async()=>{
  const a=await fixture();await click(a,'admin:grant:2');await click(a,'admin:audit',3);
  assert.match(bodies(a).at(-1).text,/ارتقا به مدیر/);
  assert.match(bodies(a).at(-1).text,/کاربر: 2.*مدیر: 1/);
});

test('legacy approve and revoke commands retain owner authorization and conditional persistence',async()=>{
  const a=await fixture();await a.request('POST',{},message('/approve 5'),header);
  assert.equal(a.store.get(KEY).approved.includes('5'),false);
  await click(a,'admin:approve_guest:5');
  assert.ok(a.store.get(KEY).approved.includes('5'));
  await a.request('POST',{},message('/revoke 5'),header);assert.equal(a.store.get(KEY).approved.includes('5'),false);
  assert.ok(changes(a).every(x=>x.options.ifMatch));
});

test('storage outages cannot replace or erase access state',async()=>{
  const a=await fixture({readError:key=>key===KEY});
  await click(a,'admin:grant:2');await a.request('POST',{},message('/approve 5'),header);
  await a.request('POST',{},message('/start',6),header);
  assert.equal(changes(a).length,0);assert.deepEqual(a.store.get(KEY),state());
});

test('concurrent role removal prevents a stale delegated approval from overwriting it',async()=>{
  let conflict=true;
  const a=await fixture({beforeWrite:(key,value,options,store)=>{
    if(key===KEY&&conflict){conflict=false;store.set(KEY,{...store.get(KEY),delegatedAdmins:[]});}
  }});
  await click(a,'admin:approve_guest:5',3);
  assert.equal(changes(a).length,0);assert.deepEqual(a.store.get(KEY).delegatedAdmins,[]);
  assert.equal(a.store.get(KEY).approved.includes('5'),false);assert.ok(a.store.get(KEY).pending['5']);
  assert.equal(bodies(a).some(x=>x.chat_id===5),false);
});

test('private operational access-health route requires sync auth and discloses counts only',async()=>{
  const a=await fixture();assert.equal((await a.request('GET',{data:'access-health'})).code,401);
  const r=await a.request('GET',{data:'access-health'}, {},{'x-portfolio-sync-secret':'fixture-secondary'});
  assert.equal(r.code,200);assert.equal(r.data.owner_count,1);assert.equal(r.data.approved_count,2);
  assert.equal(r.data.delegated_admin_count,1);assert.equal(r.data.conditional_updates_ready,true);
  assert.equal(r.data.approved,undefined);assert.equal(r.data.users,undefined);
});

test('conditional storage canary verifies conflict rejection without touching access or holdings',async()=>{
  const a=await fixture();a.store.set('portfolio/latest.json',a.payload);
  assert.equal((await a.request('POST',{verify:'access-storage'})).code,401);
  const r=await a.request('POST',{verify:'access-storage'}, {},{'x-portfolio-sync-secret':'fixture-secondary'});
  assert.equal(r.code,200);assert.equal(r.data.conditional_writes_verified,true);
  assert.equal(r.data.storage_metadata.read_etag_matches_head,true);
  assert.equal(r.data.storage_metadata.weak_read_etag,false);
  assert.equal(r.data.storage_metadata.etag,undefined);
  assert.equal(changes(a).length,0);assert.deepEqual(a.store.get(KEY),state());
  assert.deepEqual(a.store.get('portfolio/latest.json'),a.payload);
  assert.equal(a.store.get('portfolio/diagnostics/access-storage.json').stage,2);
});

test('private failure diagnostics classify rejected actions without storing identities or exception messages',async()=>{
  const a=await fixture();await click(a,'admin:demote:1');
  const failure=a.store.get('portfolio/diagnostics/last-access-change.json');
  assert.equal(failure.kind,'access_change_denied');assert.equal(failure.operation,'demote');
  assert.equal(failure.committed,false);assert.deepEqual(Object.keys(failure).sort(),['at','committed','kind','operation']);
  assert.equal(changes(a).length,0);
  const r=await a.request('POST',{verify:'access-storage'}, {},{'x-portfolio-sync-secret':'fixture-secondary'});
  assert.equal(r.data.latest_failure.kind,'access_change_denied');
  assert.equal((await a.request('POST',{verify:'access-storage'})).code,401);
});


test('promotion and demotion use strong identity ETags for compressible Persian access JSON',async()=>{
  const a=await fixture({compressAccessReads:true});
  a.store.get(KEY).users['2'].first_name='کاربر آزمایشی '.repeat(150);
  await click(a,'admin:grant:2');
  assert.deepEqual(a.store.get(KEY).delegatedAdmins,['3','2']);
  assert.equal(callbacks(a).at(-1).text,'انجام شد.');
  await click(a,'admin:demote:2');
  assert.deepEqual(a.store.get(KEY).delegatedAdmins,['3']);
  assert.equal(a.store.get(KEY).approved.includes('2'),true);
  assert.equal(callbacks(a).at(-1).text,'انجام شد.');
  assert.equal(changes(a).length,2);
  assert.ok(changes(a).every(x=>x.options.ifMatch&&!x.options.ifMatch.startsWith('W/')));
  assert.deepEqual(a.store.get(KEY).audit.map(x=>x.action),['grant','demote']);
});

test('a storage server ignoring identity cannot turn a weak ETag into an unconditional permission update',async()=>{
  const a=await fixture({forceWeakEtag:true});
  await click(a,'admin:grant:2');
  assert.equal(changes(a).length,0);assert.deepEqual(a.store.get(KEY),state());
  assert.equal(a.store.get('portfolio/diagnostics/last-access-change.json').kind,'access_state_unavailable');
});

test('identity reads preserve conflict rejection for large Persian records',async()=>{
  const a=await fixture({compressAccessReads:true,beforeWrite:(key,value,options,store)=>{
    if(key===KEY)store.set(KEY,{...store.get(KEY),approved:['3']});
  }});
  a.store.get(KEY).users['2'].first_name='نام فارسی '.repeat(150);
  await click(a,'admin:grant:2');
  assert.equal(changes(a).length,0);assert.deepEqual(a.store.get(KEY).approved,['3']);
  assert.equal(a.store.get('portfolio/diagnostics/last-access-change.json').kind,'precondition_failed');
});
