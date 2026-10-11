import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from './helpers/app-fixture.mjs';

const header={'x-telegram-bot-api-secret-token':'fixture-webhook'};
const callbackHeader={'x-portfolio-sync-secret':'fixture-secondary'};
const message=text=>({message:{chat:{id:1,type:'private'},from:{id:1},text}});
const method=call=>call.url.split('/').at(-1);
const body=call=>JSON.parse(call.options.body);
const deleted=a=>a.sends.filter(x=>method(x)==='deleteMessage').map(body);

test('a successful text reply deletes only the preceding temporary bot notice',async()=>{
  const a=await app();
  await a.ns.sendTelegram(1,'waiting',{temporary:true});
  await a.ns.sendTelegram(1,'permanent report');
  assert.deepEqual(a.sends.map(method),['sendMessage','sendMessage','deleteMessage']);
  assert.deepEqual(deleted(a),[{chat_id:1,message_id:1}]);
  await a.ns.sendTelegram(1,'another report');
  assert.equal(deleted(a).length,1);
  assert.equal(a.store.get('portfolio/temporary-replies/1.json').messages.length,0);
});

test('a successful image replaces the temporary notice and remains in history',async()=>{
  const a=await app();await a.ns.sendTelegram(1,'EcoCoach price?',{temporary:true});
  await a.ns.sendTelegramPhoto(1,Buffer.from('synthetic PNG'),'report');
  await a.ns.sendTelegram(1,'next report');
  assert.deepEqual(deleted(a),[{chat_id:1,message_id:1}]);
  assert.equal(a.sends[1].options.body.get('caption'),'report');
});

for(const failedMethod of ['sendMessage','sendPhoto'])
  test(`failed ${failedMethod} preserves the prompt until a later successful reply`,async()=>{
    let fail=true;
    const a=await app({telegramReply:call=>method(call)===failedMethod&&a.sends.length>1&&fail?
      {ok:false,status:500}:null});
    await a.ns.sendTelegram(1,'waiting',{temporary:true});
    if(failedMethod==='sendMessage')await a.ns.sendTelegram(1,'failed reply');
    else await a.ns.sendTelegramPhoto(1,Buffer.from('PNG'),'failed image');
    assert.equal(deleted(a).length,0);
    assert.equal(a.store.get('portfolio/temporary-replies/1.json').messages[0].message_id,1);
    fail=false;await a.ns.sendTelegram(1,'delivered reply');
    assert.deepEqual(deleted(a),[{chat_id:1,message_id:1}]);
  });

test('temporary messages are isolated between private chats',async()=>{
  const a=await app();await a.ns.sendTelegram(1,'waiting',{temporary:true});
  await a.ns.sendTelegram(2,'other chat reply');assert.equal(deleted(a).length,0);
  await a.ns.sendTelegram(1,'reply');assert.equal(deleted(a)[0].chat_id,1);
});

test('transient deletion failures are retried after the next successful delivery',async()=>{
  let fail=true;
  const a=await app({telegramReply:call=>method(call)==='deleteMessage'&&fail?{ok:false,status:429}:null});
  await a.ns.sendTelegram(1,'waiting',{temporary:true});await a.ns.sendTelegram(1,'report');
  assert.equal(a.store.get('portfolio/temporary-replies/1.json').messages.length,1);
  fail=false;await a.ns.sendTelegram(1,'next report');
  assert.equal(deleted(a).length,2);
  assert.equal(a.store.get('portfolio/temporary-replies/1.json').messages.length,0);
});

test('already deleted messages do not interrupt report delivery',async()=>{
  const a=await app({telegramReply:call=>method(call)==='deleteMessage'?{ok:false,status:400}:null});
  await a.ns.sendTelegram(1,'waiting',{temporary:true});await a.ns.sendTelegram(1,'report');
  assert.equal(a.store.get('portfolio/temporary-replies/1.json').messages.length,0);
});

test('an older send response cannot replace or delete a newer price prompt',async()=>{
  let release;
  const a=await app({telegramReply:(call,id)=>body(call).text==='slow'?
    new Promise(resolve=>{release=()=>resolve({ok:true,result:{message_id:id}});}):null});
  const slow=a.ns.sendTelegram(1,'slow',{temporary:true});
  assert.equal(typeof release,'function');
  await a.ns.sendTelegram(1,'new prompt',{temporary:true});release();await slow;
  assert.equal(a.store.get('portfolio/temporary-replies/1.json').messages[0].message_id,2);
  assert.deepEqual(deleted(a),[{chat_id:1,message_id:1}]);
});

test('expired temporary notices respect the Telegram 48-hour deletion limit',async()=>{
  const a=await app();await a.ns.sendTelegram(1,'initial reply');
  a.store.set('portfolio/temporary-replies/1.json',{
    lastDeliveredId:1,messages:[{message_id:1,created_at:'2020-01-01T00:00:00Z'}]});
  await a.ns.sendTelegram(1,'next reply');
  assert.equal(deleted(a).length,0);
  assert.equal(a.store.get('portfolio/temporary-replies/1.json').messages.length,0);
});

test('complete fresh allocation flow removes both waiting notices and the EcoCoach prompt',async()=>{
  const a=await app();
  const complete=async()=>{
    const id=JSON.parse(a.dispatches.at(-1).options.body).inputs.request_id;
    const snapshot={...a.payload,updated_at:new Date().toISOString(),assets:{...a.assets,'بلک راک':15}};
    a.store.set('portfolio/latest.json',snapshot);
    await a.request('POST',{complete:'latest-allocation'},
      {request_id:id,ok:true,snapshot_updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at},callbackHeader);
  };
  await a.request('POST',{},message('آخرین تخصیص دارایی'),header);await complete();
  const prompt=a.sends.filter(x=>method(x)==='sendMessage').at(-1);
  assert.match(body(prompt).text,/قیمت فعلی هر واحد صندوق بلک/);
  await a.request('POST',{},message('۸۵۰٬۰۰۰ تومان'),header);await complete();
  assert.equal(deleted(a).length,3);
  assert.equal(a.store.get('portfolio/temporary-replies/1.json').messages.length,0);
  assert.equal(a.sends.filter(x=>method(x)==='sendPhoto').length,1);
});
