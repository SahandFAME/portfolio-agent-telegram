import { put, get } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import path from "path";

const SNAPSHOT = "portfolio/latest.json";
const ACCESS_STATE = "portfolio/access-control.json";
const BLACKROCK_PENDING_PREFIX = "portfolio/pending-blackrock/";
const ASSETS = [
  "طلا","عیار","گوهر","آلتون","امرالد","زرفام","نهال","طعام","استیل",
  "فلز فارابی","پتروآگاه","خودران","بلک راک","سجام","فملی","شمش نقره 999",
  "BTC","ETH","Tether","Link","ADA","SOL","ONDO",
  "سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","دلار"
];
const MANUAL = {"سکه تمام":3,"ربع سکه غیره":3,"ربع سکه بانکی":1,"آبشده (طلب)":1.37,"آبشده (شمش زربد)":20,"دلار":3030};

const LISTED = {
  "طلا":"طلا","عیار":"عیار","گوهر":"گوهر","آلتون":"آلتون","امرالد":"امرالد",
  "زرفام":"زرفام","نهال":"نهال","طعام":"طعام","استیل":"استیل",
  "فلز فارابی":"فلزفارابی","پتروآگاه":"پتروآگاه","خودران":"خودران",
  "سجام":"سجام","فملی":"فملی"
};
const SHAKHESBAN_TYPE = {
  "سجام":"stock","فملی":"stock"
};
const CRYPTO_IDS = {
  BTC:"bitcoin", ETH:"ethereum", Tether:"tether", Link:"chainlink",
  ADA:"cardano", SOL:"solana", ONDO:"ondo-finance"
};

export default async function handler(req,res){
  if(req.method==="GET"){
    if(req.query?.setup==="webhook") return setup(req,res);
    if(req.query?.data==="portfolio") return readSnapshot(req,res);
    return res.status(200).json({ok:true,service:"Portfolio Agent Telegram Bot"});
  }
  if(req.method==="POST" && req.query?.sync==="portfolio") return sync(req,res);
  if(req.method==="POST") return telegram(req,res);
  return res.status(405).json({ok:false,error:"Method not allowed"});
}

function syncAuth(req){return !!process.env.PORTFOLIO_SYNC_SECRET && req.headers["x-portfolio-sync-secret"]===process.env.PORTFOLIO_SYNC_SECRET}

async function sync(req,res){
  if(!syncAuth(req)) return res.status(401).json({ok:false,error:"Unauthorized"});
  const b=req.body||{};
  if(!b.version||!b.updated_at||typeof b.assets!=="object"||Array.isArray(b.assets))
    return res.status(400).json({ok:false,error:"Invalid portfolio payload"});
  const assets={};
  for(const [name,value] of Object.entries(b.assets)){
    const n=Number(value);
    if(!Number.isFinite(n)||n<0) return res.status(400).json({ok:false,error:"Invalid quantity for "+name});
    assets[name]=n;
  }
  const snapshot={version:String(b.version),updated_at:String(b.updated_at),workbook_updated_at:b.workbook_updated_at?String(b.workbook_updated_at):null,assets};
  try{
    await put(SNAPSHOT,JSON.stringify(snapshot,null,2),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
    return res.status(200).json({ok:true,received:Object.keys(assets).length,stored:true,updated_at:snapshot.updated_at});
  }catch(e){console.error(e);return res.status(500).json({ok:false,error:"Unable to store portfolio snapshot"});}
}

async function loadSnapshot(){
  const r=await get(SNAPSHOT,{access:"private",useCache:false});
  if(!r)return null;
  const reader=r.stream.getReader(),chunks=[];
  while(true){const x=await reader.read();if(x.done)break;chunks.push(Buffer.from(x.value));}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readSnapshot(req,res){
  if(!syncAuth(req))return res.status(401).json({ok:false,error:"Unauthorized"});
  try{const snapshot=await loadSnapshot();if(!snapshot)return res.status(404).json({ok:false,error:"No portfolio snapshot available"});return res.status(200).json({ok:true,snapshot});}
  catch(e){console.error(e);return res.status(404).json({ok:false,error:"No portfolio snapshot available"});}
}

async function loadPendingBlackRock(chatId){
  try{
    const r=await get(BLACKROCK_PENDING_PREFIX+String(chatId)+".json",{access:"private",useCache:false});
    if(!r)return null;
    const reader=r.stream.getReader(),chunks=[];
    while(true){const x=await reader.read();if(x.done)break;chunks.push(Buffer.from(x.value));}
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }catch(e){return null;}
}
async function savePendingBlackRock(chatId,pending){
  await put(BLACKROCK_PENDING_PREFIX+String(chatId)+".json",JSON.stringify(pending),{
    access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"
  });
}
function parseUserPrice(text){
  const raw=String(text||"");
  const isRial=/ریال/i.test(raw);
  const n=parseNum(raw.replace(/تومان|ریال/gi,"").replace(/\s/g,""));
  if(n===null||n<=0)return null;
  // User is asked for toman/unit. If they explicitly provide rial, keep it as rial.
  return isRial?n:n*10;
}
async function telegram(req,res){
  const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
  if(secret&&req.headers["x-telegram-bot-api-secret-token"]!==secret)return res.status(401).json({ok:false});
  const callback=req.body?.callback_query;
  if(callback){waitUntil(handleAccessCallback(callback));return res.status(200).json({ok:true});}
  const message=req.body?.message;
  if(!message?.chat?.id)return res.status(200).json({ok:true});
  const userId=message.from?.id;
  if(message.chat.type!=="private"||userId===undefined)return res.status(200).json({ok:true});
  const command=(message.text||"").trim();
  const uid=String(userId);
  const adminIds=adminUserIds();
  const state=await loadAccessState();
  const approved=new Set([...(state.approved||[]).map(String),...adminIds]);
  const isAdmin=adminIds.includes(uid);
  if(isAdmin&&(/^\/users(?:@\w+)?$/.test(command)||/^\/revoke(?:@\w+)?\s+\d+$/.test(command)||/^\/approve(?:@\w+)?\s+\d+$/.test(command))){
    waitUntil(handleAdminAccessCommand(message.chat.id,command,state,adminIds));
    return res.status(200).json({ok:true});
  }
  if(!approved.has(uid)){
    if(/^\/(start|request|help)(?:@\w+)?$/.test(command)){
      const result=await requestAccess(uid,message.from,adminIds,state);
      waitUntil(sendTelegram(message.chat.id,result));
    }else{
      waitUntil(sendTelegram(message.chat.id,"This bot is private. Send /start to request access."));
    }
    return res.status(200).json({ok:true});
  }

  waitUntil((async()=>{
    try{
      const snapshot=await safeSnapshot();
      const quantities={...(snapshot?.assets||{}),...MANUAL};
      const pending=await loadPendingBlackRock(message.chat.id);
      let reply=null;
      if(pending?.type==="blackrock_price"){
        const priceRial=parseUserPrice(command);
        if(priceRial===null){
          reply="لطفاً قیمت فعلی هر واحد بلک راک (EcoCoach) را به تومان وارد کنید.";
        }else{
          const report=await allocationImageReply(quantities,priceRial);
          if(report.text)reply=report.text;
          else await sendTelegramPhoto(message.chat.id,report.png,"گزارش ارزش‌گذاری پرتفوی • قیمت‌های زنده");
          await savePendingBlackRock(message.chat.id,{type:"none",updatedAt:new Date().toISOString()});
        }
      }else if(command==="/start"||command==="/help")reply=help();
      else if(command==="/status")reply=snapshot?("پورتفولیو متصل است.\n\nآخرین Snapshot معاملات: "+snapshot.updated_at+(snapshot.workbook_updated_at?"\nآخرین به‌روزرسانی فایل: "+snapshot.workbook_updated_at:"")):"پورتفولیو متصل است، اما Snapshot معاملات هنوز همگام‌سازی نشده است.";
      else if(command==="/assets")reply="دارایی‌های پرتفوی (۲۹ مورد)\n\n"+ASSETS.map((x,i)=>(i+1)+". "+x+": "+(quantities[x]===undefined?"همگام‌سازی نشده":format(quantities[x]))).join("\n")+(snapshot?"\n\nSnapshot: "+snapshot.updated_at:"");
      else if(command==="/gold")reply=await valuationReply(quantities,["طلا","عیار","گوهر","آلتون","امرالد","زرفام","نهال","طعام","سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","شمش نقره 999"],"طلا و فلزات گرانبها");
      else if(command==="/crypto")reply=await valuationReply(quantities,["BTC","ETH","Tether","Link","ADA","SOL","ONDO"],"رمزارز");
      else if(command==="/cash")reply=await valuationReply(quantities,["دلار"],"دلار و نقدینگی");
      else if(command==="/allocation"||command==="/refresh"){
        const report=await allocationImageReply(quantities,null);
        if(report.text){
          reply=report.text;
          if(report.text.includes("قیمت فعلی هر واحد صندوق بلک"))await savePendingBlackRock(message.chat.id,{type:"blackrock_price",requestedAt:new Date().toISOString()});
        }else await sendTelegramPhoto(message.chat.id,report.png,"گزارش ارزش‌گذاری پرتفوی • قیمت‌های زنده");
      }else reply=help();
      if(reply)await sendTelegram(message.chat.id,reply);
    }catch(e){console.error("Telegram handler error:",e);try{await sendTelegram(message.chat.id,"خطا در تهیه گزارش. لطفاً دوباره تلاش کنید.");}catch(_){}}
  })());
  return res.status(200).json({ok:true});
}
async function fetchJson(url){
  const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36","Accept":"application/json,text/plain,*/*"},cache:"no-store"});
  if(!r.ok) throw new Error("HTTP "+r.status);
  return await r.json();
}

async function fetchText(url){
  const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36","Accept":"text/html,application/xhtml+xml,*/*"},cache:"no-store"});
  if(!r.ok) throw new Error("HTTP "+r.status);
  return await r.text();
}


function adminUserIds(){
  return [...new Set(String(process.env.TELEGRAM_ADMIN_USER_IDS||"").split(/[\s,]+/).map(x=>x.trim()).filter(x=>/^\d+$/.test(x)))];
}
async function loadAccessState(){
  try{
    const r=await get(ACCESS_STATE,{access:"private",useCache:false});
    if(!r)return {approved:[],pending:{}};
    const reader=r.stream.getReader(),chunks=[];
    while(true){const x=await reader.read();if(x.done)break;chunks.push(Buffer.from(x.value));}
    const state=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return {approved:Array.isArray(state.approved)?state.approved.map(String):[],pending:state.pending&&typeof state.pending==="object"?state.pending:{}};
  }catch(e){return {approved:[],pending:{}};}
}
async function saveAccessState(state){
  await put(ACCESS_STATE,JSON.stringify(state,null,2),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
async function requestAccess(uid,user,adminIds,state){
  if(!adminIds.length)return "Access requests are not configured yet. Your Telegram user ID is "+uid+". Ask the bot owner to configure admin access.";
  if((state.approved||[]).map(String).includes(uid)||adminIds.includes(uid))return "You are already authorised. Send /help to see available commands.";
  state.pending=state.pending||{};
  if(state.pending[uid])return "Your access request is already pending. The bot admin has been notified.";
  state.pending[uid]={id:uid,first_name:String(user.first_name||""),last_name:String(user.last_name||""),username:String(user.username||""),requestedAt:new Date().toISOString()};
  await saveAccessState(state);
  const display=[user.first_name,user.last_name].filter(Boolean).join(" ")||"Telegram user";
  const who=display+(user.username?" (@"+user.username+")":"")+"\nUser ID: "+uid;
  for(const adminId of adminIds){
    await sendTelegramWithKeyboard(adminId,"New portfolio bot access request\n\n"+who,[[{text:"Approve",callback_data:"access:approve:"+uid},{text:"Reject",callback_data:"access:reject:"+uid}]]);
  }
  return "Your access request has been sent to the bot admin. You will receive a message when it is reviewed.";
}
async function handleAccessCallback(callback){
  const m=String(callback.data||"").match(/^access:(approve|reject):(\d+)$/);
  const uid=String(callback.from?.id||"");
  if(!m||!adminUserIds().includes(uid)){await answerCallback(callback.id,"Not authorised.");return;}
  const state=await loadAccessState(),target=m[2],action=m[1],request=state.pending?.[target];
  if(!request){await answerCallback(callback.id,"Request no longer pending.");return;}
  if(action==="approve"){
    state.approved=[...new Set([...(state.approved||[]).map(String),target])];
    delete state.pending[target];await saveAccessState(state);
    await answerCallback(callback.id,"User approved.");
    await sendTelegram(callback.message.chat.id,"Approved user ID "+target+".");
    await sendTelegram(Number(target),"Your access request was approved. Send /help to see available commands.");
  }else{
    delete state.pending[target];await saveAccessState(state);
    await answerCallback(callback.id,"Request rejected.");
    await sendTelegram(callback.message.chat.id,"Rejected user ID "+target+".");
    await sendTelegram(Number(target),"Your access request was rejected.");
  }
}
async function handleAdminAccessCommand(chatId,command,state,adminIds){
  if(/^\/users(?:@\w+)?$/.test(command)){
    const approved=[...new Set([...(state.approved||[]).map(String),...adminIds])];
    const pending=Object.keys(state.pending||{});
    await sendTelegram(chatId,"Authorised user IDs:\n"+(approved.join("\n")||"None")+"\n\nPending requests:\n"+(pending.join("\n")||"None")+"\n\nRevoke access with /revoke USER_ID.");
    return;
  }
  const revoke=command.match(/^\/revoke(?:@\w+)?\s+(\d+)$/);
  if(revoke){
    const target=revoke[1];
    if(adminIds.includes(target)){await sendTelegram(chatId,"Admin IDs cannot be revoked with this command.");return;}
    state.approved=(state.approved||[]).map(String).filter(x=>x!==target);
    delete (state.pending||{})[target];await saveAccessState(state);
    await sendTelegram(chatId,"Access revoked for user ID "+target+".");
    await sendTelegram(Number(target),"Your access to the portfolio bot has been revoked.");
    return;
  }
  const approve=command.match(/^\/approve(?:@\w+)?\s+(\d+)$/);
  if(approve){
    const target=approve[1];state.approved=[...new Set([...(state.approved||[]).map(String),target])];
    delete (state.pending||{})[target];await saveAccessState(state);
    await sendTelegram(chatId,"Approved user ID "+target+".");
    await sendTelegram(Number(target),"Your access request was approved. Send /help to see available commands.");
  }
}
async function sendTelegramWithKeyboard(chatId,text,inlineKeyboard){
  const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)return;
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text,reply_markup:{inline_keyboard:inlineKeyboard}})});
  if(!r.ok)console.error("Telegram access request notification failed:",r.status);
}
async function answerCallback(callbackId,text){
  const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)return;
  await fetch("https://api.telegram.org/bot"+token+"/answerCallbackQuery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({callback_query_id:callbackId,text})});
}

function parseNum(v){
  if(v===null||v===undefined)return null;
  const s=String(v)
    .replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/[,٬،]/g,"")
    .replace(/<[^>]*>/g,"")
    .trim();
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}

async function tgju(slug,range){
  // Prefer TGJU's gem host, which currently exposes the live profile quote;
  // fall back to the canonical www host only if the primary fetch/parse fails.
  const hosts=["https://gem.tgju.org/profile/","https://www.tgju.org/profile/"];
  let lastError=null;
  for(const base of hosts){
    try{
      const html=await fetchText(base+slug);
      const plain=normMarketText(String(html||"")
        .replace(/<script[\s\S]*?<\/script>/gi," ")
        .replace(/<style[\s\S]*?<\/style>/gi," ")
        .replace(/<[^>]+>/g," ")
        .replace(/&nbsp;/gi," "));
      // Read only the first numeric value immediately following the first
      // "نرخ فعلی" marker. Do not scan a large page region, which can capture
      // unrelated historical/high/low values and mistake them for the quote.
      const marker=plain.indexOf("نرخ فعلی");
      if(marker<0)throw new Error("TGJU current-price marker not found");
      const tail=plain.slice(marker+ "نرخ فعلی".length, marker+ "نرخ فعلی".length+180);
      const hit=tail.match(/[۰-۹٠-٩0-9][۰-۹٠-٩0-9,٬،]*/);
      const rial=hit?parseNum(hit[0]):null;
      if(rial===null||rial<=0)throw new Error("TGJU current price not found");
      if(range&&(rial<range[0]||rial>range[1]))throw new Error("TGJU current price failed validation");
      const result={priceRial:rial,source:"TGJU ("+new URL(base).hostname+")",retrievedAt:new Date().toISOString()};
      console.info("TGJU quote retrieved",JSON.stringify({slug,priceRial:rial,source:result.source,retrievedAt:result.retrievedAt}));
      return result;
    }catch(e){
      lastError=e;
      console.warn("TGJU profile fetch/parse failed",slug,base,e.message);
    }
  }
  throw new Error("TGJU current price unavailable: "+(lastError?.message||"unknown error"));
}
async function tsetmc(symbol){
  const q=encodeURIComponent(symbol);
  const search=await fetchJson("https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/"+q);
  const rows=search.instrumentSearch||[];
  const norm=s=>String(s||"").replace(/[يى]/g,"ی").replace(/ك/g,"ک").replace(/\s+/g,"").trim();
  const target=norm(symbol);
  const hit=rows.find(x=>norm(x.lVal18AFC)===target)||rows.find(x=>norm(x.lVal30).includes(target));
  if(!hit)throw new Error("TSETMC symbol not found");
  const quote=await fetchJson("https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/"+hit.insCode);
  const p=quote?.closingPriceInfo?.pDrCotVal ?? quote?.closingPriceInfo?.pClosing;
  const priceRial=parseNum(p);
  if(priceRial===null)throw new Error("TSETMC price not found");
  return {priceRial,source:"TSETMC",symbol:hit.lVal18AFC,retrievedAt:new Date().toISOString()};
}

function normMarketText(s){
  return String(s||"")
    .replace(/[يى]/g,"ی").replace(/ك/g,"ک")
    .replace(/[\u200c\u200d]/g,"")
    .replace(/\s+/g," ")
    .trim();
}
function parseMarketPage(html,symbol){
  const target=normMarketText(symbol);
  const rows=[...String(html||"").matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(m=>m[0]);
  for(const row of rows){
    const text=normMarketText(row
      .replace(/<script[\s\S]*?<\/script>/gi," ")
      .replace(/<style[\s\S]*?<\/style>/gi," ")
      .replace(/<[^>]+>/g," ")
      .replace(/&nbsp;/gi," "));
    if(!text.includes(target))continue;
    const nums=[...text.matchAll(/[۰-۹٠-٩0-9][۰-۹٠-٩0-9,٬،]*(?:\.[۰-۹٠-٩0-9]+)?/g)]
      .map(m=>parseNum(m[0])).filter(x=>x!==null);
    if(!nums.length)continue;
    const priceRial=nums[0];
    if(Number.isFinite(priceRial)&&priceRial>0)
      return {priceRial,source:"TGJU markets/all",symbol,retrievedAt:new Date().toISOString()};
  }
  return null;
}
async function tgjuMarket(symbol,htmls){
  for(const html of htmls||[]){const p=parseMarketPage(html,symbol);if(p)return p;}
  throw new Error("TGJU market symbol not found: "+symbol);
}

async function shakhesban(symbol,type){
  const slug=encodeURIComponent(symbol);
  const types=type?[type]:["fund","stock"];
  let lastError="not found";
  for(const t of types){
    try{
      const html=await fetchText("https://www.shakhesban.com/markets/"+t+"/"+slug);
      const plain=normMarketText(html
        .replace(/<script[\s\S]*?<\/script>/gi," ")
        .replace(/<style[\s\S]*?<\/style>/gi," ")
        .replace(/<[^>]+>/g," ")
        .replace(/&nbsp;/gi," "));
      const marker=plain.indexOf("آخرین قیمت");
      if(marker<0){lastError="آخرین قیمت not found";continue;}
      const tail=plain.slice(marker,marker+160);
      const m=tail.match(/[۰-۹٠-٩0-9][۰-۹٠-٩0-9,٬،]*/);
      const priceRial=m?parseNum(m[0]):null;
      if(priceRial===null||priceRial<=0){lastError="last price not found";continue;}
      return {priceRial,source:"Shakhesban",symbol,retrievedAt:new Date().toISOString()};
    }catch(e){lastError=e.message;}
  }
  throw new Error("Shakhesban price unavailable: "+lastError);
}

async function shakhesbanSilverBar(){
  const html=await fetchText("https://www.shakhesban.com/ime/gavahi");
  const plain=normMarketText(String(html||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," "));
  const marker=plain.indexOf("SilverBar");
  if(marker<0)throw new Error("SilverBar row not found");
  const tail=plain.slice(marker,marker+700);
  const nums=[...tail.matchAll(/[۰-۹٠-٩0-9][۰-۹٠-٩0-9,٬،]*(?:\.[۰-۹٠-٩0-9]+)?/g)]
    .map(m=>parseNum(m[0])).filter(x=>x!==null);
  // The row contains the silver purity 999.9 before the market price.
  const priceRial=nums.find(x=>x>=1000000&&x<=100000000);
  if(!priceRial||priceRial<=0)throw new Error("SilverBar last trade not found");
  return {priceRial,source:"Shakhesban IME",symbol:"SilverBar",retrievedAt:new Date().toISOString(),unit:"IRR/g"};
}

async function getListedPrice(asset,marketHtmls){
  const symbol=LISTED[asset];
  const type=SHAKHESBAN_TYPE[asset];
  let shakhesError=null;
  try{return await shakhesban(symbol,type);}
  catch(e){shakhesError=e;}
  try{
    if(!marketHtmls?.length)throw new Error("TGJU market pages unavailable");
    return await tgjuMarket(symbol,marketHtmls);
  }catch(e2){
    try{return await tsetmc(symbol);}
    catch(e3){
      console.error("Listed price failed:",asset,
        "Shakhesban:",shakhesError?.message||"n/a",
        "/ TGJU:",e2.message,"/ TSETMC:",e3.message);
      throw new Error(asset+" price unavailable");
    }
  }
}

async function getPrices(){
  const prices={};
  const errors={};
  const goldDefs={
    "شمش نقره 999":{imeSilver:true,unit:"IRR/g"},
    "سکه تمام":{slug:"sekee",range:[1000000000,10000000000],unit:"IRR/coin"},
    "ربع سکه بانکی":{slug:"rob",range:[500000000,1500000000],unit:"IRR/coin"},
    "ربع سکه غیره":{gold18Quarter:true,unit:"IRR/coin"},
    "آبشده (طلب)":{slug:"gold_futures",range:[500000000,2000000000],unit:"IRR/mithqal",perGram:true},
    "آبشده (شمش زربد)":{slug:"gold_futures",range:[500000000,2000000000],unit:"IRR/mithqal",perGram:true},
    "دلار":{slug:"price_dollar_rl",range:[500000,5000000],unit:"IRR/USD"}
  };
  const marketHtmls=[];
  for(const url of [
    "https://www.tgju.org/markets/all",
    "https://www.tgju.org/markets/all?flow=1",
    "https://www.tgju.org/markets/all?flow=2"
  ]){
    try{marketHtmls.push(await fetchText(url));}
    catch(e){console.error("TGJU market table fetch failed:",url,e.message);}
  }
  const profileCache=new Map();
  const tgjuCached=async(slug,range)=>{
    const key=slug+"|"+range.join(",");
    if(!profileCache.has(key))profileCache.set(key,tgju(slug,range));
    return await profileCache.get(key);
  };
  const jobs=Object.entries(goldDefs).map(async([asset,d])=>{
    try{
      let p;
      if(d.imeSilver)p=await shakhesbanSilverBar();
      else if(d.gold18Quarter){
        const gold18=await tgjuCached("geram18",[100000000,1000000000]);
        p={...gold18,priceRial:gold18.priceRial*2.03325,source:"TGJU 18K gold × quarter-coin weight",unit:"IRR/coin"};
      }else p=await tgjuCached(d.slug,d.range);
      if(d.perGram)p.priceRial=p.priceRial/4.6083;
      prices[asset]={...p,unit:d.perGram?"IRR/g":d.unit};
    }catch(e){errors[asset]=e.message;console.error("Gold/metal price failed:",asset,e.message);}
  });
  jobs.push(...Object.keys(LISTED).map(async asset=>{
    try{prices[asset]=await getListedPrice(asset,marketHtmls);}catch(e){errors[asset]=e.message;}
  }));
  try{
    const ids=Object.values(CRYPTO_IDS).join(",");
    const data=await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids="+encodeURIComponent(ids)+"&vs_currencies=usd");
    for(const [asset,id] of Object.entries(CRYPTO_IDS)){
      const p=parseNum(data?.[id]?.usd);
      if(p===null)errors[asset]="Crypto price unavailable"; else prices[asset]={priceUsd:p,source:"CoinGecko",retrievedAt:new Date().toISOString(),unit:"USD"};
    }
  }catch(e){for(const asset of Object.keys(CRYPTO_IDS))errors[asset]="CoinGecko unavailable";}
  await Promise.all(jobs);
  // These require asset-specific market data; never substitute a similarly named instrument.
  // بلک راک is the user's EcoCoach private fund. Its current price must be supplied by the user for each valuation.
  // The allocation flow prompts for it rather than substituting a similarly named security.
  errors["بلک راک"]="USER_INPUT_REQUIRED";
  return {prices,errors};
}

function valueRial(asset,qty,p,usdIrr){
  if(["BTC","ETH","Tether","Link","ADA","SOL","ONDO"].includes(asset))return qty*p.priceUsd*usdIrr;
  if(asset==="دلار")return qty*p.priceRial;
  return qty*p.priceRial;
}

async function valuationReply(q,names,title){
  const {prices,errors}=await getPrices();
  let usdIrr=prices["دلار"]?.priceRial;
  if(!usdIrr) return title+"\n\nUSD/IRR price unavailable; valuation cannot be calculated.";
  const lines=[title+"\n"];
  let total=0;
  for(const name of names){
    if(errors[name]||!prices[name]){lines.push(name+": "+(errors[name]||"price unavailable"));continue;}
    const v=valueRial(name,q[name]||0,prices[name],usdIrr);
    total+=v;
    lines.push(name+": "+format(q[name])+" × "+formatPrice(name,prices[name])+" = "+formatToman(v));
  }
  lines.push("\nSubtotal: "+formatToman(total));
  lines.push("\nPrices retrieved: "+new Date().toISOString());
  return lines.join("\n");
}

const REPORT_GROUP={
  "سکه تمام":"طلا","ربع سکه غیره":"طلا","ربع سکه بانکی":"طلا","آبشده (طلب)":"طلا","آبشده (شمش زربد)":"طلا",
  "طلا":"صندوق طلا","عیار":"صندوق طلا","گوهر":"صندوق طلا","آلتون":"صندوق طلا","امرالد":"صندوق طلا","زرفام":"صندوق طلا",
  "شمش نقره 999":"گواهی سپرده","نهال":"صندوق کالایی","طعام":"صندوق بخشی","استیل":"صندوق سهامی","فلز فارابی":"صندوق سهامی",
  "پتروآگاه":"صندوق سهامی","خودران":"صندوق سهامی","بلک راک":"صندوق","سجام":"سهام","فملی":"سهام",
  "BTC":"رمز ارز","ETH":"رمز ارز","Tether":"رمز ارز","Link":"رمز ارز","ADA":"رمز ارز","SOL":"رمز ارز","ONDO":"رمز ارز","دلار":"فیات"
};
const REPORT_UNIT={
  "سکه تمام":"عدد","ربع سکه غیره":"عدد","ربع سکه بانکی":"عدد","آبشده (طلب)":"گرم","آبشده (شمش زربد)":"گرم",
  "طلا":"سهم","عیار":"سهم","گوهر":"سهم","آلتون":"سهم","امرالد":"سهم","زرفام":"سهم","شمش نقره 999":"واحد",
  "نهال":"سهم","طعام":"سهم","استیل":"سهم","فلز فارابی":"سهم","پتروآگاه":"سهم","خودران":"سهم","بلک راک":"سهم","سجام":"سهم","فملی":"سهم",
  "BTC":"-","ETH":"-","Tether":"-","Link":"-","ADA":"-","SOL":"-","ONDO":"-","دلار":"-"
};
function valueUsd(v,usdIrr){return usdIrr>0?v/usdIrr:0;}
function portfolioTable(q,vals,total,prices,usdIrr){
  const header=["#","گروه","دارایی","مقدار","واحد","قیمت واحد","ارزش کل تومان","ارزش کل دلار","%","منبع"];
  const categoryRank={"طلا و سکه":0,"نقره":1,"سهام و صندوق":2,"رمز ارز":3,"Tether":4,"US Dollar":5};
  const subgroupRank={
    "سکه تمام":0,"ربع سکه غیره":0,"ربع سکه بانکی":0,"آبشده (طلب)":0,"آبشده (شمش زربد)":0,
    "طلا":1,"عیار":1,"گوهر":1,"آلتون":1,"امرالد":1,"زرفام":1,
    "شمش نقره 999":0,
    "سهام":0,"صندوق سهامی":1,"صندوق بخشی":2,"صندوق کالایی":3,"صندوق طلا":4,"صندوق":5,
    "رمز ارز":0,"فیات":0
  };
  const rows=Object.entries(vals).sort((a,b)=>{
    const ga=categoryRank[categoryName(a[0])]??99,gb=categoryRank[categoryName(b[0])]??99;
    if(ga!==gb)return ga-gb;
    const sa=subgroupRank[REPORT_GROUP[a[0]]]??(categoryName(a[0])==="طلا و سکه"?9:99);
    const sb=subgroupRank[REPORT_GROUP[b[0]]]??(categoryName(b[0])==="طلا و سکه"?9:99);
    return sa-sb || b[1]-a[1];
  }).map(([a,v],i)=>{
    const p=prices[a];
    if(!p) throw new Error("Missing price metadata for "+a);
    const qty=q[a]||0;
    const unit=p.priceUsd!==undefined ? "$"+format(p.priceUsd) : formatToman(p.priceRial);
    return [String(i+1),REPORT_GROUP[a]||"-",a,format(qty),REPORT_UNIT[a]||"-",unit,format(v/10),format(valueUsd(v,usdIrr)),(v/total*100).toFixed(1)+"%",p.source||"-"];
  });
  const widths=header.map((h,i)=>Math.max(h.length,...rows.map(r=>r[i].length)));
  const line=r=>r.map((x,i)=>String(x).padEnd(widths[i]," ")).join(" | ");
  return "<pre>"+line(header)+"\n"+rows.map(line).join("\n")+"</pre>";
}
async function allocationReply(q,blackRockPriceRial=null){
  const {prices,errors}=await getPrices();
  const usdIrr=prices["دلار"]?.priceRial;
  if(!usdIrr)return "Allocation unavailable: current USD/IRR price could not be obtained.";
  let total=0;const vals={};
  for(const a of ASSETS){
    if(errors[a]||!prices[a])continue;
    const qty=Number(q[a]||0);
    if(!Number.isFinite(qty)||qty<0){errors[a]="Invalid quantity";continue;}
    vals[a]=valueRial(a,qty,prices[a],usdIrr); total+=vals[a];
  }
  if(blackRockPriceRial!==null){
    const v=(q["بلک راک"]||0)*blackRockPriceRial;
    vals["بلک راک"]=v;
    total+=v;
    delete errors["بلک راک"];
  }
  const missing=ASSETS.filter(a=>
    (errors[a]||!prices[a]) &&
    !(a==="بلک راک" && blackRockPriceRial!==null)
  );
  if(errors["بلک راک"]==="USER_INPUT_REQUIRED" && blackRockPriceRial===null){
    return "Portfolio valuation needs one additional input.\n\nPlease send the current EcoCoach بلک راک price per unit in toman.\nQuantity: "+format(q["بلک راک"]||0)+" units\n\nExample: 850000";
  }
  if(!total)return "Allocation unavailable: no current prices were obtained.";
  const reportPrices={...prices};
  if(blackRockPriceRial!==null) reportPrices["بلک راک"]={priceRial:blackRockPriceRial,source:"User input",retrievedAt:new Date().toISOString(),unit:"IRR/unit"};
  const table=portfolioTable(q,vals,total,reportPrices,usdIrr);
  const sources=[...new Set(Object.keys(vals).map(a=>reportPrices[a]?.source).filter(Boolean))].join(", ");
  const lines=["<b>Portfolio valuation — live prices</b>","","<b>Total:</b> "+formatToman(total)+" | <b>USD:</b> $"+format(valueUsd(total,usdIrr)),"","<i>Unit prices and sources are shown below.</i>","",table];
  if(missing.length)lines.push("\n<b>Not valued:</b> "+missing.join(", "));
  lines.push("\n<b>Price sources:</b> "+sources);
  lines.push("<b>Retrieved:</b> "+new Date().toISOString());
  return lines.join("\n");
}


function cryptoAsset(asset){return ["BTC","ETH","Tether","Link","ADA","SOL","ONDO"].includes(asset);}
function qSafe(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function sourceFa(s){
  const m={"CoinGecko":"CoinGecko","Shakhesban":"شاخص‌بان","TGJU":"TGJU","User input":"ورودی کاربر","TGJU 18K gold × quarter-coin weight":"TGJU × وزن ربع سکه"};
  return m[s]||s||"-";
}
function unitPriceDisplay(asset,p){
  if(!p)return "-";
  if(cryptoAsset(asset))return "$"+format(p.priceUsd);
  return formatToman(p.priceRial);
}
function assetUsdValue(asset,v,p,usdIrr){
  if(cryptoAsset(asset))return qSafe(p?.priceUsd)*qSafe(v===undefined?0:0); // replaced below
  if(asset==="دلار")return qSafe(v/Math.max(usdIrr,1));
  return valueUsd(v,usdIrr);
}
function categoryName(asset){
  if(asset==="دلار")return "US Dollar";
  if(asset==="Tether")return "Tether";
  if(cryptoAsset(asset))return "رمز ارز";
  if(asset==="شمش نقره 999")return "نقره";
  if(["سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","طلا","عیار","گوهر","آلتون","امرالد","زرفام"].includes(asset))return "طلا و سکه";
  return "سهام و صندوق";
}
function escXml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function svgText(x,y,text,size,opts={}){
  const anchor=opts.anchor||"start",weight=opts.weight||400,fill=opts.fill||"#18324a";
  return '<text x="'+x+'" y="'+y+'" font-family="sans-serif" font-size="'+size+'" font-weight="'+weight+'" fill="'+fill+'" text-anchor="'+anchor+'">'+escXml(text)+"</text>";
}
function compactNumber(n){return Number(n).toLocaleString("fa-IR",{maximumFractionDigits:2});}
function moneyFa(n){return compactNumber(n)+" تومان";}
function usdFa(n){return "$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:2});}

function buildPortfolioSvg(q,vals,total,prices,usdIrr){
  const assetEn={
    "طلا":"Tala Gold Fund","عیار":"Ayar Gold Fund","گوهر":"Gohar Gold Fund","آلتون":"Alton Gold Fund",
    "امرالد":"Emerald Gold Fund","زرفام":"Zarfam Gold Fund","نهال":"Nahal Commodity Fund","طعام":"Taam Sector Fund",
    "استیل":"Steel Equity Fund","فلز فارابی":"Felez Farabi Fund","پتروآگاه":"PetroAgaah Fund","خودران":"Khodro Fund",
    "بلک راک":"EcoCoach Fund","سجام":"Sejam","فملی":"Fameli","شمش نقره 999":"999 Silver Certificate",
    "BTC":"BTC","ETH":"ETH","Tether":"Tether","Link":"LINK","ADA":"ADA","SOL":"SOL","ONDO":"ONDO",
    "سکه تمام":"Full Coin","ربع سکه غیره":"Non-bank Quarter Coin","ربع سکه بانکی":"Bank Quarter Coin",
    "آبشده (طلب)":"Gold Receivable","آبشده (شمش زربد)":"Zarbed Gold Bar","دلار":"US Dollar"
  };
  const groupEn={
    "طلا":"Gold","صندوق طلا":"Gold","گواهی سپرده":"Commodity Certificate","صندوق کالایی":"Commodity Fund",
    "صندوق بخشی":"Sector Fund","صندوق سهامی":"Equity Fund","صندوق":"Fund","سهام":"Stock","رمز ارز":"Crypto","فیات":"Fiat"
  };
  const unitEn={"عدد":"units","گرم":"g","سهم":"shares","واحد":"certificate","-":"-"};
  const sourceEn={"CoinGecko":"CoinGecko","Shakhesban":"Shakhesban","TGJU":"TGJU","User input":"User input","TGJU 18K gold × quarter-coin weight":"TGJU × quarter-coin weight"};
  const enNum=n=>Number(n).toLocaleString("en-US",{maximumFractionDigits:2});
  const toman=n=>(Math.round(Number(n)/1000)*1000).toLocaleString("en-US")+" toman";
  const usdText=n=>"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const categoryRank={"طلا و سکه":0,"نقره":1,"سهام و صندوق":2,"رمز ارز":3,"Tether":4,"US Dollar":5};
  function subgroupRank(asset){
    const category=categoryName(asset);
    if(category==="طلا و سکه"){
      if(["سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (شمش زربد)"].includes(asset))return 0;
      if(asset==="آبشده (طلب)")return 1;
      return 2;
    }
    if(category==="سهام و صندوق"){
      const group=REPORT_GROUP[asset]||"";
      return ({"سهام":0,"صندوق سهامی":1,"صندوق بخشی":2,"صندوق کالایی":3,"صندوق":4}[group]??99);
    }
    return 0;
  }
  const rows=Object.entries(vals).sort((a,b)=>{
    const ga=categoryRank[categoryName(a[0])]??99,gb=categoryRank[categoryName(b[0])]??99;
    if(ga!==gb)return ga-gb;
    const sa=subgroupRank(a[0]),sb=subgroupRank(b[0]);
    return sa-sb || b[1]-a[1];
  }).map(([a,v],i)=>{
    const p=prices[a]||{};
    const crypto=cryptoAsset(a);
    const usd=crypto?qSafe(q[a])*qSafe(p.priceUsd):(a==="دلار"?qSafe(q[a]):valueUsd(v,usdIrr));
    return {
      rank:i+1,asset:assetEn[a]||a,group:groupEn[REPORT_GROUP[a]]||REPORT_GROUP[a]||"-",
      qty:qSafe(q[a]),unit:unitEn[REPORT_UNIT[a]]||REPORT_UNIT[a]||"-",
      unitPrice:unitPriceDisplay(a,p),valueToman:v/10,valueUsd:usd,pct:total?v/total*100:0,
      source:sourceEn[p.source]||p.source||"-"
    };
  });

  // The table is deliberately placed BELOW the dashboard panels. This prevents
  // the 29-row table from ever covering the chart, cards, or summary.
  const W=1800,H=2160;
  const tableX=40,tableW=1720,rowH=37,headerY=790,headerH=48;
  const cols=[
    ["rank","#",45],["asset","Asset",245],["group","Group",175],["qty","Qty",105],["unit","Unit",100],
    ["unitPrice","Unit Price",205],["valueToman","Value (toman)",250],["valueUsd","Value (USD)",205],["pct","%",70],["source","Source",320]
  ];
  let cx=tableX;const xmap={};for(const [k,,w] of cols){xmap[k]=cx;cx+=w;}

  const cats={};
  for(const [a,v] of Object.entries(vals)){
    const k=categoryName(a);
    cats[k]=(cats[k]||0)+v;
  }
  const catOrder=["طلا و سکه","نقره","سهام و صندوق","رمز ارز","Tether","US Dollar"];
  const catColors={"طلا و سکه":"#d9a400","رمز ارز":"#7250d5","Tether":"#26a17b","US Dollar":"#43a866","سهام و صندوق":"#2f9ea4","نقره":"#718096"};
  const catEn={"طلا و سکه":"Gold & Coins","رمز ارز":"Crypto","Tether":"Tether","US Dollar":"US Dollar","سهام و صندوق":"Stocks & Funds","نقره":"Silver"};

  // Conservative text truncation keeps every cell inside its column.
  const fit=(text,width,font=13)=>{
    const s=String(text??"");
    const max=Math.max(4,Math.floor((width-16)/(font*0.58)));
    return s.length<=max?s:s.slice(0,Math.max(1,max-1))+"…";
  };

  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'"><rect width="100%" height="100%" fill="#f7fafc"/>';
  svg+='<rect x="20" y="20" width="1760" height="245" rx="22" fill="#123b5d"/>';
  svg+=svgText(1730,78,"Portfolio Valuation Report",38,{anchor:"end",weight:700,fill:"#ffffff"});
  svg+=svgText(1730,120,"Live market prices • "+new Date().toLocaleString("en-US"),21,{anchor:"end",fill:"#dce9f4"});
  svg+=svgText(70,78,toman(total/10),34,{anchor:"start",weight:700,fill:"#ffffff"});
  svg+=svgText(70,120,usdText(valueUsd(total,usdIrr)),25,{anchor:"start",fill:"#dce9f4"});
  svg+=svgText(70,160,"USD/IRR: "+Math.round(usdIrr/10).toLocaleString("en-US"),18,{anchor:"start",fill:"#dce9f4"});
  svg+=svgText(70,200,"Crypto unit prices are shown in USD",18,{anchor:"start",fill:"#dce9f4"});

  const cards=catOrder.map(name=>[name,cats[name]||0]);
  let cardX=20;
  for(const [name,val] of cards){
    const pct=total?val/total*100:0;
    const cardW=285;
    const cardToman=(Math.round((val/10)/1000)*1000).toLocaleString("en-US");
    svg+='<rect x="'+cardX+'" y="285" width="'+cardW+'" height="105" rx="16" fill="#ffffff" stroke="#d7e2eb"/>';
    svg+=svgText(cardX+cardW-14,320,catEn[name],17,{anchor:"end",weight:700});
    svg+=svgText(cardX+cardW-14,360,pct.toFixed(1)+"%",25,{anchor:"end",weight:700,fill:catColors[name]});
    svg+=svgText(cardX+14,360,cardToman+" toman",14,{anchor:"start",fill:"#526579"});
    cardX+=295;
  }

  // Top-right dashboard: larger, more graphical donut chart.
  const sx=940,sy=425,sw=820;
  svg+='<rect x="'+sx+'" y="'+sy+'" width="'+sw+'" height="330" rx="16" fill="#ffffff" stroke="#d7e2eb"/>';
  svg+=svgText(sx+sw-25,sy+42,"Asset Allocation",25,{anchor:"end",weight:700});

  const cx0=sx+215,cy0=sy+190,R=112,r0=64;let angle=-Math.PI/2;
  for(const [name,val] of cards){
    const frac=total?val/total:0;
    const a2=angle+frac*Math.PI*2;
    const x1=cx0+R*Math.cos(angle),y1=cy0+R*Math.sin(angle);
    const x2=cx0+R*Math.cos(a2),y2=cy0+R*Math.sin(a2);
    const ix1=cx0+r0*Math.cos(a2),iy1=cy0+r0*Math.sin(a2);
    const ix2=cx0+r0*Math.cos(angle),iy2=cy0+r0*Math.sin(angle);
    const large=(a2-angle)>Math.PI?1:0;
    svg+='<path d="M '+x1+' '+y1+' A '+R+' '+R+' 0 '+large+' 1 '+x2+' '+y2+' L '+ix1+' '+iy1+' A '+r0+' '+r0+' 0 '+large+' 0 '+ix2+' '+iy2+' Z" fill="'+catColors[name]+'" stroke="#ffffff" stroke-width="3"/>';
    angle=a2;
  }
  // Keep the total value in the donut center on a clean two-line label.
  svg+=svgText(cx0,cy0-7,enNum(Math.round(total/10/1000)*1000),17,{anchor:"middle",weight:700});
  svg+=svgText(cx0,cy0+20,"toman",12,{anchor:"middle",fill:"#607080"});

  // Legend is deliberately shifted to the right of the donut.
  cards.forEach(([name,val],i)=>{
    const yy=sy+82+i*47;
    const lx=sx+490;
    svg+='<rect x="'+lx+'" y="'+(yy-15)+'" width="20" height="20" rx="5" fill="'+catColors[name]+'"/>';
    svg+=svgText(lx+32,yy,catEn[name],16,{anchor:"start",weight:600});
    svg+=svgText(sx+775,yy,(total?val/total*100:0).toFixed(1)+"%",16,{anchor:"end",weight:700});
  });

  // Top-left dashboard: summary.
  const tx=40,ty=425,tw=850;
  svg+='<rect x="'+tx+'" y="'+ty+'" width="'+tw+'" height="330" rx="16" fill="#ffffff" stroke="#d7e2eb"/>';
  svg+=svgText(tx+tw-25,ty+42,"Portfolio Summary",25,{anchor:"end",weight:700});
  const summary=[["Total Value",toman(total/10)],["Total USD",usdText(valueUsd(total,usdIrr))],["Assets",String(rows.length)],["USD/IRR",Math.round(usdIrr/10).toLocaleString("en-US")],["Price Time",new Date().toLocaleString("en-US")]];
  summary.forEach(([k,v],i)=>{
    const yy=ty+92+i*48;
    svg+=svgText(tx+tw-25,yy,k,17,{anchor:"end",weight:600});
    svg+=svgText(tx+25,yy,v,16,{anchor:"start",fill:"#526579"});
  });

  // Table: full-width, below all dashboard content.
  const tableHeight=headerH+rows.length*rowH+18;
  svg+='<rect x="'+tableX+'" y="'+headerY+'" width="'+tableW+'" height="'+tableHeight+'" rx="16" fill="#ffffff" stroke="#d7e2eb"/>';
  svg+='<rect x="'+tableX+'" y="'+headerY+'" width="'+tableW+'" height="'+headerH+'" rx="16" fill="#1b4d70"/>';
  for(const [k,label,w] of cols)svg+=svgText(xmap[k]+w-8,headerY+31,label,14,{anchor:"end",weight:700,fill:"#ffffff"});
  rows.forEach((r,i)=>{
    const y=headerY+headerH+i*rowH;
    if(i%2===0)svg+='<rect x="'+tableX+'" y="'+y+'" width="'+tableW+'" height="'+rowH+'" fill="#f2f7fa"/>';
    for(const [k,,w] of cols){
      let v=r[k];
      if(k==="valueToman")v=(Math.round(Number(v)/1000)*1000).toLocaleString("en-US");
      else if(k==="valueUsd")v=usdText(v);
      else if(k==="pct")v=r.pct.toFixed(1)+"%";
      else if(k==="qty")v=enNum(v);
      const font=(k==="asset"||k==="group"||k==="source")?12:13;
      v=fit(v,w,font);
      svg+=svgText(xmap[k]+w-8,y+25,String(v),font,{anchor:"end",fill:"#243b53"});
    }
  });

  const noteY=1965;
  svg+='<rect x="40" y="'+noteY+'" width="1720" height="155" rx="16" fill="#edf4f8" stroke="#d7e2eb"/>';
  svg+=svgText(1730,noteY+38,"Notes",19,{anchor:"end",weight:700});
  svg+=svgText(1730,noteY+70,"• Crypto unit prices are displayed in USD.",14,{anchor:"end"});
  svg+=svgText(1730,noteY+98,"• Non-crypto USD values = toman value ÷ current USD/IRR.",14,{anchor:"end"});
  svg+=svgText(1730,noteY+126,"• Crypto USD values = quantity × current USD price.",14,{anchor:"end"});
  svg+=svgText(1730,noteY+150,"• EcoCoach Fund is the private fund; BlackRock Inc. is not used.",14,{anchor:"end"});
  svg+='</svg>';
  return svg;
}
async function allocationImageReply(q,blackRockPriceRial){
  const {prices,errors}=await getPrices();
  const usdIrr=prices["دلار"]?.priceRial;
  if(!usdIrr)return {text:"دریافت نرخ دلار آزاد ناموفق بود؛ ارزش‌گذاری انجام نشد."};
  let total=0;const vals={};
  for(const a of ASSETS){
    if(errors[a]||!prices[a])continue;
    const qty=Number(q[a]||0);if(!Number.isFinite(qty)||qty<0)continue;
    vals[a]=valueRial(a,qty,prices[a],usdIrr);total+=vals[a];
  }
  if(blackRockPriceRial!==null){const v=qSafe(q["بلک راک"])*blackRockPriceRial;vals["بلک راک"]=v;total+=v;delete errors["بلک راک"];}
  if(errors["بلک راک"]==="USER_INPUT_REQUIRED"&&blackRockPriceRial===null)return {text:"برای تهیه گزارش، قیمت فعلی هر واحد صندوق بلک راک (EcoCoach) را به تومان ارسال کنید.\n\nتعداد: "+format(q["بلک راک"]||0)+" واحد"};
  if(!total)return {text:"هیچ قیمت معتبر فعلی برای ارزش‌گذاری دریافت نشد."};
  const reportPrices={...prices};if(blackRockPriceRial!==null)reportPrices["بلک راک"]={priceRial:blackRockPriceRial,source:"User input",retrievedAt:new Date().toISOString(),unit:"IRR/unit"};
  const svg=buildPortfolioSvg(q,vals,total,reportPrices,usdIrr);
  const fontPath=path.join(process.cwd(),"node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
  const rendered=new Resvg(svg,{font:{fontFiles:[fontPath],loadSystemFonts:false,defaultFontFamily:"DejaVu Sans",sansSerifFamily:"DejaVu Sans"}}).render();
  const png=rendered.asPng();
  return {png,total};
}
function formatPrice(asset,p){
  return p.priceUsd!==undefined?"$"+format(p.priceUsd):formatToman(p.priceRial);
}
function formatToman(rial){return format(rial/10)+" toman";}
function format(v){return Number(v).toLocaleString("en-US",{maximumFractionDigits:8});}
function group(q,names){return names.map(n=>n+": "+(q[n]===undefined?"not synchronized":format(q[n]))).join("\n");}
function help(){return "Portfolio Agent is online.\n\n/status — portfolio status\n/assets — asset list\n/allocation — live portfolio valuation & allocation\n/gold — live gold & precious-metal valuation\n/crypto — live crypto valuation\n/cash — live cash valuation\n/refresh — refresh live market data and portfolio valuation\\n\\nFor بلک راک, the bot asks for the current EcoCoach price per unit whenever a valuation needs it.";}
async function safeSnapshot(){try{return await loadSnapshot();}catch(e){return null;}}

async function sendTelegram(chatId,text){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token){console.error("TELEGRAM_BOT_TOKEN is not configured");return;}

  const send=async msg=>{
    const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:chatId,text:msg,parse_mode:"HTML"})
    });
    if(!r.ok)console.error("Telegram API error:",await r.text());
  };

  // Telegram limits text messages to 4096 characters. Split the audit table
  // into balanced HTML <pre> blocks so large portfolio reports are delivered
  // instead of silently failing.
  if(String(text).length<=3900){await send(text);return;}

  const raw=String(text);
  const preStart=raw.indexOf("<pre>");
  const preEnd=raw.indexOf("</pre>",preStart+5);
  const m=preStart>=0 && preEnd>=0
    ? [raw.slice(0,preStart),raw.slice(preStart+5,preEnd),raw.slice(preEnd+6)]
    : null;
  if(m){
    const prefix=m[1], body=m[2], suffix=m[3];
    const lines=body.split("\\n");
    let chunk="", first=true;
    for(const line of lines){
      const candidate=chunk ? chunk+"\\n"+line : line;
      if(candidate.length>3300 && chunk){
        await send((first?prefix:"")+"<pre>"+chunk+"</pre>");
        first=false;
        chunk=line;
      }else chunk=candidate;
    }
    if(chunk)await send((first?prefix:"")+"<pre>"+chunk+"</pre>");
    if(suffix.trim())await send(suffix.trim());
    return;
  }

  const lines=String(text).split("\\n");
  let chunk="";
  for(const line of lines){
    const candidate=chunk ? chunk+"\\n"+line : line;
    if(candidate.length>3800 && chunk){await send(chunk);chunk=line;}
    else chunk=candidate;
  }
  if(chunk)await send(chunk);
}

async function sendTelegramPhoto(chatId,png,caption){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token){console.error("TELEGRAM_BOT_TOKEN is not configured");return;}
  const form=new FormData();
  form.append("chat_id",String(chatId));
  form.append("photo",new Blob([png],{type:"image/png"}),"portfolio-report.png");
  if(caption)form.append("caption",caption);
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendPhoto",{method:"POST",body:form});
  if(!r.ok)console.error("Telegram sendPhoto error:",await r.text());
}

function setup(req,res){
  if(req.query?.key===undefined)return res.status(200).send("<h1>Portfolio Agent Telegram Webhook</h1><p>Enter the SETUP_SECRET as the key query parameter.</p>");
  if(req.query.key!==process.env.SETUP_SECRET)return res.status(401).send("Authentication failed.");
  return configureWebhook(req,res);
}
async function configureWebhook(req,res){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token)return res.status(500).send("TELEGRAM_BOT_TOKEN is not configured.");
  const url="https://"+req.headers.host+"/api/telegram";
  const body={url};
  if(process.env.TELEGRAM_WEBHOOK_SECRET)body.secret_token=process.env.TELEGRAM_WEBHOOK_SECRET;
  try{
    const r=await fetch("https://api.telegram.org/bot"+token+"/setWebhook",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const result=await r.json();
    if(!r.ok||!result.ok)return res.status(500).send(result.description||"Webhook setup failed.");
    return res.status(200).send("Webhook configured successfully.");
  }catch(e){return res.status(500).send("Webhook setup failed.");}
}