import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/app-fixture.mjs';

const ACCESS_POLICY_STARTED_AT=new Date().toISOString();

const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const method=call=>call.url.split('/').at(-1);
const body=call=>JSON.parse(call.options.body);
const removed=a=>a.sends.filter(call=>method(call)==='deleteMessage').map(body);
const panelState=a=>a.store.get('portfolio/temporary-replies/1.json');
const click=(data,id=1,extra={})=>({callback_query:{id:'fixture-callback',from:{id},data,
  message:{chat:{id,type:'private'},...extra}}});
const message=(text,id=1)=>({message:{chat:{id,type:'private'},from:{id},text}});
const existingPanel=data=>({message_id:100,from:{id:99,is_bot:true},date:Math.floor(Date.now()/1000),
  reply_markup:{inline_keyboard:[[{text:'fixture option',callback_data:data}]]}});
const historicalOptions={env:{TELEGRAM_BOT_TOKEN:'99:fixture-bot'},
  telegramReply:(call,count)=>method(call)==='sendMessage'?{ok:true,result:{message_id:200+count}}:null};
async function fixture(options){
  const a=await app(options);a.store.set('portfolio/access-control.json',{
    accessPolicy:{version:1,activated_at:ACCESS_POLICY_STARTED_AT},approved:['2','3'],delegatedAdmins:['3'],pending:{},users:{},audit:[]});return a;
}

test('opening and navigating the panel leaves only the current screen tracked',async()=>{
  const a=await fixture();await a.request('POST',{},message('/admin'),header);
  assert.equal(removed(a).length,0); // retain the message that supplies the main keyboard
  for(const data of ['admin:users:0','admin:pending:0','admin:admins:0','admin:status','admin:audit','admin:home']){
    const previous=panelState(a).messages[0].message_id;
    const before=a.sends.length;
    await a.request('POST',{},click(data),header);
    const calls=a.sends.slice(before).map(method);
    assert.ok(calls.indexOf('sendMessage')<calls.indexOf('deleteMessage'));
    assert.ok(removed(a).some(x=>x.chat_id===1&&x.message_id===previous));
    assert.equal(panelState(a).messages.length,1);
    assert.ok(panelState(a).messages[0].message_id>previous);
  }
});

test('confirmation, cancellation and storage results replace their preceding screens',async()=>{
  const a=await fixture();await a.request('POST',{},message('/admin'),header);
  for(const data of ['admin:revoke:2','admin:users:0','admin:status','admin:storage_check','admin:home']){
    const previous=panelState(a).messages[0].message_id;
    await a.request('POST',{},click(data),header);
    assert.ok(removed(a).some(x=>x.message_id===previous));
    assert.equal(panelState(a).messages.length,1);
  }
  assert.ok(a.store.get('portfolio/access-control.json').approved.includes('2'));
});

test('a failed replacement leaves the previous screen available',async()=>{
  let fail=false;
  const a=await fixture({telegramReply:call=>fail&&method(call)==='sendMessage'?{ok:false,status:500}:null});
  await a.request('POST',{},message('/admin'),header);
  const previous=panelState(a).messages[0].message_id,count=removed(a).length;
  fail=true;await a.request('POST',{},click('admin:status'),header);
  assert.equal(removed(a).length,count);assert.equal(panelState(a).messages[0].message_id,previous);
  fail=false;await a.request('POST',{},click('admin:status'),header);
  assert.equal(removed(a).at(-1).message_id,previous);
});

test('a valid old bot-owned panel is deleted after its successfully delivered replacement',async()=>{
  const a=await fixture(historicalOptions);
  await a.request('POST',{},click('admin:status',1,existingPanel('admin:status')),header);
  assert.deepEqual(removed(a),[{chat_id:1,message_id:100}]);
  assert.equal(panelState(a).messages.length,1);
  assert.ok(panelState(a).messages[0].message_id>100);
});

test('failed delivery preserves an existing panel from before cleanup was deployed',async()=>{
  const a=await fixture({...historicalOptions,telegramReply:call=>method(call)==='sendMessage'?{ok:false,status:500}:null});
  await a.request('POST',{},click('admin:status',1,existingPanel('admin:status')),header);
  assert.equal(removed(a).length,0);assert.equal(panelState(a).messages[0].message_id,100);
});

test('user messages, other bots and unrelated inline messages are never registered for deletion',async()=>{
  for(const extra of [
    {...existingPanel('admin:status'),from:{id:1,is_bot:false}},
    {...existingPanel('admin:status'),from:{id:88,is_bot:true}},
    existingPanel('unrelated:option')]){
    const a=await fixture(historicalOptions);await a.request('POST',{},click('admin:status',1,extra),header);
    assert.equal(removed(a).length,0);
    assert.equal(panelState(a).messages.some(x=>x.message_id===100),false);
  }
});

test('ordinary users cannot delete panel messages through forged callbacks',async()=>{
  const a=await fixture(historicalOptions);await a.request('POST',{},click('admin:status',2,existingPanel('admin:status')),header);
  assert.equal(removed(a).length,0);assert.equal(a.store.has('portfolio/temporary-replies/2.json'),false);
});

test('unanswered access notifications remain while admin screens are replaced',async()=>{
  const a=await fixture();await a.request('POST',{},message('/start',4),header);
  const notifications=a.sends.map((call,index)=>({call,id:index+1})).filter(({call})=>
    method(call)==='sendMessage'&&body(call).reply_markup?.inline_keyboard?.flat().some(x=>x.callback_data==='admin:approve_guest:4'));
  assert.equal(notifications.length,2);
  await a.request('POST',{},message('/admin'),header);
  await a.request('POST',{},click('admin:status'),header);
  for(const {call,id} of notifications){
    assert.equal(removed(a).some(x=>String(x.chat_id)===String(body(call).chat_id)&&x.message_id===id),false);
  }
});

test('the last panel disappears when returning to a permanent portfolio report',async()=>{
  const a=await fixture();await a.request('POST',{},message('/admin'),header);
  const previous=panelState(a).messages[0].message_id;
  await a.request('POST',{},message('/status'),header);
  assert.equal(removed(a).at(-1).message_id,previous);assert.equal(panelState(a).messages.length,0);
});
