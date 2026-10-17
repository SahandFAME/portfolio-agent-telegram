import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/app-fixture.mjs';

const ACCESS_POLICY_STARTED_AT=new Date().toISOString();

const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const method=call=>call.url.split('/').at(-1);
const body=call=>JSON.parse(call.options.body);
const sent=a=>a.sends.filter(x=>method(x)==='sendMessage').map(body);
const deleted=a=>a.sends.filter(x=>method(x)==='deleteMessage').map(body);
const message=(text,id=1)=>({message:{chat:{id,type:'private'},from:{id},text}});
const click=(data,id=1)=>({callback_query:{id:'fixture-callback',data,from:{id},message:{chat:{id,type:'private'}}}});
const anchor=a=>a.store.get('portfolio/main-menu/1.json').message_id;
const pendingPanel=a=>a.store.get('portfolio/temporary-replies/1.json').messages[0].message_id;
async function fixture(options){
  const a=await app(options);a.store.set('portfolio/access-control.json',{
    accessPolicy:{version:1,activated_at:ACCESS_POLICY_STARTED_AT},approved:['2','3'],delegatedAdmins:['3'],pending:{},users:{},audit:[]});return a;
}
// Simulate the client behavior reported by the owner: deleting the message
// that supplied its reply keyboard clears that keyboard.
function visibleKeyboard(a){
  let sourceId=null;
  a.sends.forEach((call,index)=>{
    if(method(call)==='sendMessage'&&body(call).reply_markup?.keyboard)sourceId=index+1;
    if(method(call)==='deleteMessage'&&body(call).message_id===sourceId)sourceId=null;
  });return sourceId;
}

test('admin cleanup retains the keyboard source across all panel navigation',async()=>{
  const a=await fixture();await a.request('POST',{},message('/admin'),header);
  const source=anchor(a);assert.equal(visibleKeyboard(a),source);
  for(const data of ['admin:status','admin:users:0','admin:pending:0','admin:admins:0','admin:audit','admin:home']){
    const oldPanel=pendingPanel(a);await a.request('POST',{},click(data),header);
    assert.ok(deleted(a).some(x=>x.message_id===oldPanel));
    assert.equal(deleted(a).some(x=>x.message_id===source),false);
    assert.equal(visibleKeyboard(a),source);
  }
});

test('every admin screen offers return to the main report menu',async()=>{
  const a=await fixture();await a.request('POST',{},message('/admin'),header);
  for(const data of ['admin:home','admin:status','admin:users:0','admin:pending:0','admin:admins:0','admin:audit','admin:revoke:2','admin:storage_check']){
    await a.request('POST',{},click(data),header);
    assert.ok(sent(a).at(-1).reply_markup.inline_keyboard.flat().some(button=>
      button.text==='بازگشت به منوی اصلی'&&button.callback_data==='admin:main_menu'));
  }
});

test('return to main menu restores report buttons and removes only old panel and menu anchor',async()=>{
  const a=await fixture();await a.request('POST',{},message('/status'),header);
  const reportId=1;await a.request('POST',{},message('/admin'),header);
  const oldAnchor=anchor(a),oldPanel=pendingPanel(a);
  await a.request('POST',{},click('admin:main_menu'),header);
  const reply=sent(a).at(-1);assert.match(reply.text,/منوی اصلی پرتفوی/);
  assert.ok(reply.reply_markup.keyboard.flat().some(x=>x.text==='آخرین ترکیب دارایی'));
  assert.ok(deleted(a).some(x=>x.message_id===oldPanel));assert.ok(deleted(a).some(x=>x.message_id===oldAnchor));
  assert.equal(deleted(a).some(x=>x.message_id===reportId),false);
  assert.equal(a.store.get('portfolio/temporary-replies/1.json').messages.length,0);
  assert.equal(visibleKeyboard(a),anchor(a));
});

test('reopening admin panel keeps a single main-menu anchor and a live keyboard',async()=>{
  const a=await fixture();await a.request('POST',{},message('/admin'),header);
  const old=anchor(a);await a.request('POST',{},message('/admin'),header);
  assert.ok(deleted(a).some(x=>x.message_id===old));
  assert.equal(deleted(a).some(x=>x.message_id===anchor(a)),false);
  assert.equal(visibleKeyboard(a),anchor(a));
});

test('failed return delivery preserves the panel and the existing keyboard anchor',async()=>{
  let fail=false;
  const a=await fixture({telegramReply:call=>fail&&method(call)==='sendMessage'?{ok:false,status:500}:null});
  await a.request('POST',{},message('/admin'),header);
  const old=anchor(a),panel=pendingPanel(a),count=deleted(a).length;
  fail=true;await a.request('POST',{},click('admin:main_menu'),header);
  assert.equal(deleted(a).length,count);assert.equal(anchor(a),old);assert.equal(pendingPanel(a),panel);
});

test('chosen admin can return; ordinary and revoked users cannot use admin callbacks',async()=>{
  const a=await fixture();await a.request('POST',{},message('/admin',3),header);
  await a.request('POST',{},click('admin:main_menu',3),header);
  const restored=sent(a).at(-1);assert.equal(restored.chat_id,3);assert.ok(restored.reply_markup.keyboard);
  for(const id of [2,4]){
    const b=await fixture();await b.request('POST',{},click('admin:main_menu',id),header);
    assert.equal(sent(b).length,0);assert.equal(deleted(b).length,0);
  }
});

test('menu allows manual collapse without hiding automatically after every selection',async()=>{
  const a=await fixture();await a.request('POST',{},message('/admin'),header);
  const keyboard=sent(a).find(x=>x.reply_markup?.keyboard).reply_markup;
  assert.equal(keyboard.is_persistent,false);assert.equal(keyboard.one_time_keyboard,false);
});
