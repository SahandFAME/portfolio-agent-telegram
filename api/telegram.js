import { put, get, head, BlobPreconditionFailedError } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import path from "path";
import {calculateGoldWeek,mergeGoldWeeks,goldHistorySvg} from "../lib/gold-history.js";

const ONEDRIVE_CLIENT_ID = '04a73ec3-340a-4cb6-a087-7fdc4dfd93e0';
const SNAPSHOT = "portfolio/latest.json";
const ACCESS_STATE = "portfolio/access-control.json";
// Compressed Blob downloads have weak representation ETags that cannot be used
// for conditional writes. Read access JSON as identity to retain its strong ETag.
const ACCESS_READ_OPTIONS={access:"private",useCache:false,headers:{"Accept-Encoding":"identity"}};
const BLACKROCK_PENDING_PREFIX = "portfolio/pending-blackrock/";
// Owner-authorized report cutoff, compared against exact rial valuations.
const MIN_REPORT_VALUE_RIAL=50000*10;
function visibleReportAssets(vals){return ASSETS.filter(asset=>Number.isFinite(vals[asset])&&vals[asset]>=MIN_REPORT_VALUE_RIAL);}
function filteredReportValues(vals){
  const included=Object.fromEntries(visibleReportAssets(vals).map(asset=>[asset,vals[asset]]));
  return {vals:included,total:Object.values(included).reduce((sum,value)=>sum+value,0)};
}
const ASSETS = [
  "طلا","عیار","گوهر","آلتون","امرالد","زرفام","نهال","طعام","استیل",
  "فلز فارابی","پتروآگاه","خودران","بلک راک","سجام","فملی","شمش نقره 999",
  "BTC","ETH","Tether","Link","ADA","SOL","ONDO",
  "سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","دلار"
];
const MANUAL = {"سکه تمام":3,"ربع سکه غیره":3,"ربع سکه بانکی":1,"آبشده (طلب)":1.37,"آبشده (شمش زربد)":20,"دلار":3030};
// Retained historical asset comments transcribed in CODEX_HANDOFF.md, plus the
// owner's requested brief fund description. Never use comment figures as quotes.
const ASSET_COMMENTS={
  "بلک راک":"صندوق خصوصی اکوکوچ",
  "آبشده (طلب)":"طلب از مامان به ازای ما به تفاوت خرید شمش زربد (9200 تومان در گرم طلا 6718)",
  "آبشده (شمش زربد)":"شمش زربد (در گرم 6718)؛ 1404/01/26",
  "دلار":"خریدهای تاریخی: 700 دلار در 83000 (04/02/20)؛ 2300 دلار در 108800 (04/08/04)"
};
// Historical comments are private to owners/admins. Renderers default to only
// the public fund description; authorization is supplied by the server handler.
function assetLabel(asset,{includePrivateNotes=false}={}){
  return asset+(Object.hasOwn(ASSET_COMMENTS,asset)&&(asset==="بلک راک"||includePrivateNotes)?"*":"");
}
function assetCommentEntries(names,{includePrivateNotes=false}={}){
  return [...new Set(names)].filter(asset=>Object.hasOwn(ASSET_COMMENTS,asset)&&(asset==="بلک راک"||includePrivateNotes))
    .map(asset=>({asset,label:assetLabel(asset,{includePrivateNotes}),comment:ASSET_COMMENTS[asset]}));
}
function assetFootnotes(names,{html=true,includePrivateNotes=false}={}){
  const entries=assetCommentEntries(names,{includePrivateNotes});
  if(!entries.length)return "";
  return (html?"<b>یادداشت دارایی‌ها (*)</b>":"یادداشت دارایی‌ها (*)")+"\n"+
    entries.map(({label,comment})=>html?"<b>"+escXml(label)+"</b>: "+escXml(comment):label+": "+comment).join("\n");
}
function withAssetFootnotes(text,names,options={}){const notes=assetFootnotes(names,options);return text+(notes?"\n\n"+notes:"");}
const PORTFOLIO_TIME_FORMAT=new Intl.DateTimeFormat("fa-IR-u-ca-persian",{
  timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit",
  hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
});
function portfolioTime(value){
  if(!value)return "نامشخص";
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return "نامشخص";
  const parts=Object.fromEntries(PORTFOLIO_TIME_FORMAT.formatToParts(date).map(part=>[part.type,part.value]));
  return parts.year+"/"+parts.month+"/"+parts.day+" • "+parts.hour+":"+parts.minute+":"+parts.second+" (تهران)";
}
function boldPortfolioTime(value){return "<b>"+portfolioTime(value)+"</b>";}

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
    if(req.query?.data==="access-health") return readAccessHealth(req,res);
    if(["gold-history","gold-history-config","gold-history-file"].includes(req.query?.data))return historyRead(req,res);
    return res.status(200).json({ok:true,service:"Portfolio Agent Telegram Bot"});
  }
  if(req.method==="POST" && req.query?.sync==="portfolio") return sync(req,res);
  if(req.method==="POST" && req.query?.complete==="latest-allocation") return completeLatestAllocation(req,res);
  if(req.method==="POST" && req.query?.configure==="access-expiry") return configureAccessExpiry(req,res);
  if(req.method==="POST" && req.query?.maintain==="expired-access"){
    if(!syncAuth(req))return res.status(401).json({ok:false});
    try{
      const state=await loadAccessState({strict:true,purgeExpired:true});
      return res.status(200).json({ok:true,...accessExpirySummary(state)});
    }catch(_){return res.status(503).json({ok:false});}
  }
  if(req.method==="POST" && ["gold-history","gold-observation","gold-history-file"].includes(req.query?.sync))return historyWrite(req,res);
  if(req.method==="POST" && req.query?.verify==="access-storage"){
    if(!syncAuth(req))return res.status(401).json({ok:false});
    const result=await verifyAccessStorage();return res.status(result.ok?200:503).json(result);
  }
  if(req.method==="POST") return telegram(req,res);
  return res.status(405).json({ok:false,error:"Method not allowed"});
}

function syncAuth(req){const supplied=req.headers["x-portfolio-sync-secret"];return !!supplied && ((!!process.env.PORTFOLIO_SYNC_SECRET && supplied===process.env.PORTFOLIO_SYNC_SECRET)||(!!process.env.PORTFOLIO_SYNC_SECRET_AGENT && supplied===process.env.PORTFOLIO_SYNC_SECRET_AGENT));}

async function sync(req,res){
  if(!syncAuth(req)){
    console.warn("Portfolio sync rejected: missing or invalid sync secret",new Date().toISOString());
    return res.status(401).json({ok:false,error:"Unauthorized"});
  }
  const b=req.body||{};
  if(!b.version||!b.updated_at||!Number.isFinite(Date.parse(String(b.updated_at)))||
     (b.workbook_updated_at&&!Number.isFinite(Date.parse(String(b.workbook_updated_at))))||
     !b.assets||typeof b.assets!=="object"||Array.isArray(b.assets))
    return res.status(400).json({ok:false,error:"Invalid portfolio payload"});
  const assets={};
  for(const [name,value] of Object.entries(b.assets)){
    const n=value;
    if(typeof n!=="number"||!Number.isFinite(n)||n<0) return res.status(400).json({ok:false,error:"Invalid quantity for "+name});
    assets[name]=n;
  }
  const journalAssets=ASSETS.filter(name=>!Object.prototype.hasOwnProperty.call(MANUAL,name));
  const missing=journalAssets.filter(name=>!Object.prototype.hasOwnProperty.call(assets,name));
  const unexpected=Object.keys(assets).filter(name=>!journalAssets.includes(name));
  if(missing.length||unexpected.length){
    console.warn("Portfolio sync rejected: incomplete or unexpected asset set",JSON.stringify({missingCount:missing.length,unexpectedCount:unexpected.length,receivedCount:Object.keys(assets).length}));
    return res.status(400).json({ok:false,error:"Incomplete or unexpected asset set",missing,unexpected});
  }
  const snapshot={version:String(b.version),updated_at:String(b.updated_at),workbook_updated_at:b.workbook_updated_at?String(b.workbook_updated_at):null,assets};
  try{
    const previous=await loadSnapshot();
    const incomingStamp=Date.parse(snapshot.workbook_updated_at||snapshot.updated_at);
    const previousStamp=Date.parse(previous?.workbook_updated_at||previous?.updated_at||"");
    if(Number.isFinite(previousStamp)&&incomingStamp<previousStamp){
      return res.status(409).json({ok:false,error:"Refusing to replace a newer portfolio snapshot",current_updated_at:previous.workbook_updated_at||previous.updated_at});
    }
    await put(SNAPSHOT,JSON.stringify(snapshot,null,2),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
    console.info("Portfolio snapshot stored",JSON.stringify({received:Object.keys(assets).length,updated_at:snapshot.updated_at,workbook_updated_at:snapshot.workbook_updated_at}));
    return res.status(200).json({ok:true,received:Object.keys(assets).length,stored:true,updated_at:snapshot.updated_at});
  }catch(e){console.error("Portfolio snapshot storage failed",e.message);return res.status(500).json({ok:false,error:"Unable to store portfolio snapshot"});}
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
  try{const snapshot=await loadSnapshot();if(!snapshot)return res.status(404).json({ok:false,error:"No portfolio snapshot available"});return res.status(200).json({ok:true,snapshot,latest_allocation_configured:!!process.env.GITHUB_ACTIONS_TOKEN,admin_dashboard_configured:adminUserIds().length>0});}
  catch(e){console.error(e);return res.status(404).json({ok:false,error:"No portfolio snapshot available"});}
}
async function readAccessHealth(req,res){
  if(!syncAuth(req))return res.status(401).json({ok:false});
  try{
    const state=await loadAccessState({strict:true});
    return res.status(200).json({ok:true,owner_count:adminUserIds().length,
      approved_count:state.approved.filter(id=>hasBotAccess(id,state)).length,pending_count:Object.keys(state.pending).length,
      delegated_admin_count:state.delegatedAdmins.length,audit_count:state.audit.length,
      guest_count:state.approved.filter(id=>hasBotAccess(id,state)&&!canReadReports(id,state)).length,guest_chart_only:true,
      financial_advisor_count:state.financialAdvisors.filter(id=>hasBotAccess(id,state)).length,advisor_reports_only:true,
      access_expiry_configured:!!state.accessPolicy,access_duration_days:7,command_notifications_enabled:true,...accessExpirySummary(state),
      conditional_updates_ready:!state._exists||!!state._etag});
  }catch(_){return res.status(503).json({ok:false,error:"Access storage unavailable"});}
}
async function verifyAccessStorage(){
  // Exercise representative UTF-8 access JSON on a separate private canary.
  // Never write actual permissions or holdings, or disclose identities/ETags.
  const key="portfolio/diagnostics/access-storage.json",id=crypto.randomUUID();
  const padding="آزمون ذخیره‌سازی نقش مهمان و مدیر ".repeat(512);
  let phase="access_metadata",metadata,latestFailure;
  try{
    latestFailure=await readPrivateJson("portfolio/diagnostics/last-access-change.json");
    const access=await get(ACCESS_STATE,ACCESS_READ_OPTIONS);
    if(access){
      const info=await head(ACCESS_STATE);
      metadata={read_etag_matches_head:access.blob?.etag===info.etag,
        weak_read_etag:String(access.blob?.etag||"").startsWith("W/"),
        weak_head_etag:String(info.etag||"").startsWith("W/"),
        access_size_bytes:info.size};
      await access.stream.cancel();
    }
    phase="canary_create";
    await writePrivateJson(key,{check_id:id,stage:1,padding});
    phase="canary_read";
    const initial=await get(key,ACCESS_READ_OPTIONS);
    const etag=initial?.blob?.etag;
    await initial?.stream?.cancel();
    if(!etag||etag.startsWith("W/"))throw new Error("missing_strong_etag");
    const options={access:"private",addRandomSuffix:false,contentType:"application/json",ifMatch:etag};
    phase="conditional_update";
    await put(key,JSON.stringify({check_id:id,stage:2,padding}),options);
    phase="readback";
    const readback=await readPrivateJson(key);
    if(readback?.check_id!==id||readback.stage!==2||readback.padding!==padding)throw new Error("canary_readback_failed");
    phase="stale_update";
    try{
      await put(key,JSON.stringify({check_id:id,stage:3,padding}),options);
      return {ok:false,conditional_writes_verified:false,failure_phase:phase,storage_metadata:metadata,latest_failure:latestFailure};
    }catch(error){
      if(!(error instanceof BlobPreconditionFailedError))throw new Error("unexpected_canary_error");
    }
    return {ok:true,conditional_writes_verified:true,storage_metadata:metadata,latest_failure:latestFailure};
  }catch(error){return {ok:false,conditional_writes_verified:false,failure_phase:phase,
    failure_kind:error instanceof BlobPreconditionFailedError?"precondition_failed":"storage_error",storage_metadata:metadata,latest_failure:latestFailure};}
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
  if(!secret)return res.status(503).json({ok:false});
  if(secret&&req.headers["x-telegram-bot-api-secret-token"]!==secret)return res.status(401).json({ok:false});
  const callback=req.body?.callback_query;
  if(callback){waitUntil(String(callback.data||"").startsWith("history:")?handleHistoryCallback(callback):String(callback.data||"").startsWith("allocation:")?handleAllocationCallback(callback,req.body.update_id):handleAccessCallback(callback));return res.status(200).json({ok:true});}
  const message=req.body?.message;
  if(!message?.chat?.id)return res.status(200).json({ok:true});
  const userId=message.from?.id;
  if(message.chat.type!=="private"||userId===undefined||String(message.chat.id)!==String(userId))return res.status(200).json({ok:true});
  const text=(message.text||"").trim();
  const command=MENU_COMMANDS.get(text)||text;
  const uid=String(userId);
  const state=await loadAccessState({purgeExpired:true});
  const isAdmin=isBotAdmin(uid,state);
  const noteOptions={includePrivateNotes:isAdmin};
  waitUntil(notifyCommandActivity(req.body,message,command,state));
  if(isExpiredMember(uid,state)&&!/^\/(start|request)(?:@\w+)?$/.test(command))return res.status(200).json({ok:true});
  if(/^\/admin(?:@\w+)?$/.test(command)||(isAdmin&&(/^\/users(?:@\w+)?$/.test(command)||/^\/revoke(?:@\w+)?\s+\d+$/.test(command)||/^\/approve(?:@\w+)?\s+\d+$/.test(command)))){
    waitUntil(handleAdminAccessCommand(message.chat.id,command,uid));
    return res.status(200).json({ok:true});
  }
  if(!hasBotAccess(uid,state)){
    if(/^\/(start|request|help)(?:@\w+)?$/.test(command)){
      let result;
      try{result=await requestAccess(uid,message.from);}
      catch(_){result="ثبت درخواست دسترسی فعلاً ممکن نیست. لطفاً دوباره تلاش کنید.";}
      waitUntil(sendTelegram(message.chat.id,result,{removeMenu:true}));
    }else{
      waitUntil(sendTelegram(message.chat.id,"This bot is private. Send /start to request access.",{removeMenu:true}));
    }
    return res.status(200).json({ok:true});
  }
  if(canReadReports(uid,state)&&command==="/gold_history"){
    waitUntil(sendGoldHistory(message.chat.id).catch(()=>sendTelegram(message.chat.id,'دریافت تاریخچه فعلاً ممکن نیست؛ دوباره تلاش کنید.',{menu:true}))); return res.status(200).json({ok:true});
  }
  if(isAdmin&&message.reply_to_message?.message_id&&!command.startsWith("/")){
    const prompt=await readPrivateJson("portfolio/gold-history/prompts/"+uid+"/"+message.reply_to_message.message_id+".json");
    if(prompt){waitUntil(acceptHistoryPrice(message.chat.id,uid,prompt.week_ending,command).catch(()=>sendTelegram(message.chat.id,'قیمت یا وضعیت هفته تغییر کرده است؛ تاریخچه را دوباره باز کنید.',{menu:true,audience:'admin'})));return res.status(200).json({ok:true});}
  }

  if(!canReadReports(uid,state)){
    waitUntil((async()=>{
      try{
      if(command==="/allocation_chart"){
        const reply=await requestLatestAllocation(message.chat.id,uid,null,"chart");
        await sendTelegram(message.chat.id,reply,{menu:true,temporary:true,audience:"guest"});
      }else await sendTelegram(message.chat.id,guestHelp(),{menu:true,audience:"guest"});
      }catch(_){await sendTelegram(message.chat.id,"دریافت نمودار ناموفق بود. لطفاً دوباره تلاش کنید.",{menu:true,audience:"guest"});}
    })());
    return res.status(200).json({ok:true});
  }

  const reportCommands=new Set(["/start","/help","/menu","/assets","/latest_allocation","/allocation_chart",
    "/gold","/gold_and_other_precious_metals","/crypto","/cash_dollar"]);
  if(!isAdmin&&!reportCommands.has(command)&&(command.startsWith("/")||parseUserPrice(command)===null)){
    waitUntil(sendTelegram(message.chat.id,"دسترسی مشاور مالی فقط شامل گزارش‌های دارایی است؛ از منوی گزارش‌ها استفاده کنید.",{menu:true}));
    return res.status(200).json({ok:true});
  }

  waitUntil((async()=>{
    try{
      const pending=await loadPendingBlackRock(message.chat.id);
      if(command==="/latest_allocation"){
        await showAllocationMenu(message.chat.id);
        return;
      }
      if(command==="/allocation_chart"){
        await sendTelegram(message.chat.id,await requestLatestAllocation(message.chat.id,userId,null,"chart"),{menu:true,temporary:true});return;
      }
      if(pending?.type==="allocation_format_selection"&&!command.startsWith("/")){
        await showAllocationMenu(message.chat.id);return;
      }
      if(pending?.type==="latest_sync_pending"&&!command.startsWith("/")){
        await sendTelegram(message.chat.id,withAssetFootnotes("دریافت و تأیید مقادیر تازه در حال انجام است. لطفاً منتظر درخواست قیمت "+assetLabel("بلک راک")+" بمانید.",["بلک راک"]),{menu:true,temporary:true});return;
      }
      if(pending?.type==="latest_blackrock_price"&&!command.startsWith("/")){
        const priceRial=parseUserPrice(command);
        const reply=priceRial===null?withAssetFootnotes("لطفاً قیمت فعلی هر واحد "+assetLabel("بلک راک")+" (EcoCoach) را به تومان وارد کنید.",["بلک راک"]):
          await requestLatestAllocation(message.chat.id,userId,priceRial,pending.report_format||"image");
        await sendTelegram(message.chat.id,reply,{menu:true,temporary:true});return;
      }
      const snapshot=await safeSnapshot();
      const quantities={...(snapshot?.assets||{}),...MANUAL};
      let reply=null;
      const valuationCommands=["/allocation","/refresh","/gold","/gold_and_other_precious_metals","/crypto","/cash_dollar"];
      const quantityStatus=quantitySnapshotStatus(snapshot);
      if((valuationCommands.includes(command)||(pending?.type==="blackrock_price"&&!command.startsWith("/")))&&quantityStatus.stale){
        reply=isAdmin?quantityStatus.message:quantityStatus.message.replace("/status","/latest_allocation");
      }else if(pending?.type==="blackrock_price"&&!command.startsWith("/")){
        const priceRial=parseUserPrice(command);
        if(priceRial===null){
          reply=withAssetFootnotes("لطفاً قیمت فعلی هر واحد "+assetLabel("بلک راک")+" (EcoCoach) را به تومان وارد کنید.",["بلک راک"]);
        }else{
          const report=await allocationImageReply(quantities,priceRial,noteOptions);
          if(report.text)reply=report.text;
          else await sendTelegramPhoto(message.chat.id,report.png,"گزارش ارزش‌گذاری پرتفوی • قیمت‌های زنده",{audience:isAdmin?"admin":"report"});
          await savePendingBlackRock(message.chat.id,{type:"none",updatedAt:new Date().toISOString()});
        }
      }else if(command==="/start"||command==="/help"||command==="/menu")reply=help({reportsOnly:!isAdmin});
      else if(command==="/status"){
        const status=quantitySnapshotStatus(snapshot);
        reply=snapshot?("پورتفولیو متصل است.\n\nآخرین Snapshot معاملات: "+boldPortfolioTime(snapshot.updated_at)+(snapshot.workbook_updated_at?"\nآخرین به‌روزرسانی فایل: "+boldPortfolioTime(snapshot.workbook_updated_at):"")+(status.stale?"\n\n⚠️ "+status.message:"\n\nوضعیت Snapshot: به‌روز")):"پورتفولیو متصل است، اما Snapshot معاملات هنوز همگام‌سازی نشده است.";
      }
      else if(command==="/assets")reply=await filteredAssetsReply(quantities,snapshot,noteOptions);
      else if(command==="/gold_and_other_precious_metals"||command==="/gold")reply=await valuationReply(quantities,["طلا","عیار","گوهر","آلتون","امرالد","زرفام","سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","شمش نقره 999"],"طلا و فلزات گرانبها",snapshot,noteOptions);
      else if(command==="/crypto")reply=await valuationReply(quantities,["BTC","ETH","Tether","Link","ADA","SOL","ONDO"],"رمزارز",snapshot,noteOptions);
      else if(command==="/cash_dollar")reply=await valuationReply(quantities,["دلار"],"دلار نقدی",snapshot,noteOptions);
      else reply=help({reportsOnly:!isAdmin});
      if(reply){
        const categoryReport=["/gold","/gold_and_other_precious_metals","/crypto","/cash_dollar"].includes(command);
        const chunks=categoryReport?splitAssetReportParagraphs(reply):[reply];
        for(const chunk of chunks){
          if(!await sendTelegram(message.chat.id,chunk,{menu:true,audience:isAdmin?"admin":"report",temporary:chunk.includes("قیمت فعلی هر واحد بلک راک")}))break;
        }
      }
    }catch(e){console.error("Telegram handler error:",e);try{await sendTelegram(message.chat.id,"خطا در تهیه گزارش. لطفاً دوباره تلاش کنید.",{menu:true});}catch(_){}}
  })());
  return res.status(200).json({ok:true});
}
const ALLOCATION_REQUEST_PREFIX="portfolio/latest-allocation/requests/";
const ALLOCATION_ACTIVE_PREFIX="portfolio/latest-allocation/active/";
const ALLOCATION_SELECTION_PREFIX="portfolio/latest-allocation/selections/";
const ALLOCATION_DEADLINE_MS=10*60*1000;
async function showAllocationMenu(chatId){
  if(!canReadReports(String(chatId),await loadAccessState({strict:true})))return;
  const selection={selection_id:crypto.randomUUID(),created_at:new Date().toISOString(),used:false};
  await writePrivateJson(ALLOCATION_SELECTION_PREFIX+chatId+".json",selection);
  await savePendingBlackRock(chatId,{type:"allocation_format_selection",selection_id:selection.selection_id});
  await sendMainMenu(chatId);
  if(!canReadReports(String(chatId),await loadAccessState({strict:true})))return;
  const data=format=>"allocation:pick:"+selection.selection_id+":"+format;
  await deliverTelegram(chatId,"sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    chat_id:chatId,text:"آخرین ترکیب دارایی\n\nنوع گزارش را انتخاب کنید. پس از انتخاب، مقادیر تازه از OneDrive و قیمت‌های تازه بازار دریافت می‌شوند.",
    reply_markup:{inline_keyboard:[[{text:"گزارش تصویری",callback_data:data("image")},{text:"گزارش متنی",callback_data:data("text")}],
      [{text:"بازگشت به منوی اصلی",callback_data:data("menu")}]]}
  })},{temporary:true});
}
async function handleAllocationCallback(callback,updateId){
  const uid=String(callback.from?.id||""),chat=callback.message?.chat;
  if(chat?.type!=="private"||String(chat.id)!==uid){await answerCallback(callback.id,"دسترسی غیرمجاز.");return;}
  try{
    const state=await loadAccessState({strict:true,purgeExpired:true});
    if(!hasBotAccess(uid,state)){await answerCallback(callback.id,isExpiredMember(uid,state)?"":"دسترسی ندارید.");return;}
    const match=String(callback.data||"").match(/^allocation:pick:([0-9a-f-]{36}):(image|text|menu)$/);
    if(match?.[2]!=="menu"&&!canReadReports(uid,state)){await answerCallback(callback.id,"فقط نمودار درصدی برای مهمان قابل دسترسی است.");return;}
    const selection=await readPrivateJson(ALLOCATION_SELECTION_PREFIX+chat.id+".json");
    const age=Date.now()-Date.parse(selection?.created_at);
    if(!match||selection?.selection_id!==match[1]||selection.used||!Number.isFinite(age)||age<0||age>ALLOCATION_DEADLINE_MS){
      await answerCallback(callback.id,"این منو منقضی شده است؛ آخرین ترکیب دارایی را دوباره انتخاب کنید.");return;
    }
    waitUntil(notifyCommandActivity({update_id:updateId,callback_query:callback},null,"/latest_allocation "+match[2],state));
    await writePrivateJson(ALLOCATION_SELECTION_PREFIX+chat.id+".json",{...selection,used:true});
    await answerCallback(callback.id,"");
    await trackPreviousAdminPanel(chat.id,callbackPanelToReplace(callback));
    if(match[2]==="menu"){
      const pending=await loadPendingBlackRock(chat.id);
      if(pending?.type==="allocation_format_selection")await savePendingBlackRock(chat.id,{type:"none"});
      await sendMainMenu(chat.id);return;
    }
    await sendTelegram(chat.id,await requestLatestAllocation(chat.id,uid,null,match[2]),{menu:true,temporary:true});
  }catch(_){await answerCallback(callback.id,"انتخاب گزارش ناموفق بود؛ دوباره تلاش کنید.");}
}
async function readPrivateJson(key){
  const item=await get(key,{access:"private",useCache:false});
  if(!item)return null;
  const reader=item.stream.getReader(),chunks=[];
  while(true){const part=await reader.read();if(part.done)break;chunks.push(Buffer.from(part.value));}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function writePrivateJson(key,value){
  await put(key,JSON.stringify(value),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
async function requestLatestAllocation(chatId,userId,blackRockPriceRial=null,reportFormat="image"){
  const state=await loadAccessState({strict:true}),uid=String(userId);
  if(String(chatId)!==uid||!hasBotAccess(uid,state))return isExpiredMember(uid,state)?"":"دسترسی ندارید.";
  if(!canReadReports(uid,state)&&(reportFormat!=="chart"||blackRockPriceRial!==null))return guestHelp();
  const token=process.env.GITHUB_ACTIONS_TOKEN;
  if(!token)return "دریافت تازه از OneDrive هنوز پیکربندی نشده است. گزارش قبلی به‌عنوان گزارش تازه نمایش داده نمی‌شود.";
  const active=await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+chatId+".json");
  const prior=active?.request_id?await readPrivateJson(ALLOCATION_REQUEST_PREFIX+active.request_id+".json"):null;
  if(prior?.status==="queued"&&Date.now()-Date.parse(prior.requested_at)<ALLOCATION_DEADLINE_MS&&(prior.report_format||"image")===reportFormat)
    return "درخواست دریافت تازه از OneDrive در حال انجام است. لطفاً منتظر پاسخ بمانید.";
  const id=crypto.randomUUID();
  const record={request_id:id,chat_id:chatId,user_id:String(userId),status:"queued",
    requested_at:new Date().toISOString(),blackRockPriceRial,report_format:reportFormat};
  await writePrivateJson(ALLOCATION_REQUEST_PREFIX+id+".json",record);
  await writePrivateJson(ALLOCATION_ACTIVE_PREFIX+chatId+".json",{request_id:id});
  await savePendingBlackRock(chatId,{type:"latest_sync_pending",request_id:id,requestedAt:record.requested_at});
  try{
    const response=await fetch("https://api.github.com/repos/SahandFAME/portfolio-agent-telegram/actions/workflows/latest-allocation-sync.yml/dispatches",{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(12000),
      headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28"},
      body:JSON.stringify({ref:"main",inputs:{client_id:ONEDRIVE_CLIENT_ID,request_id:id}})
    });
    if(response.status!==204)throw new Error("dispatch_failed");
  }catch(_){
    await writePrivateJson(ALLOCATION_REQUEST_PREFIX+id+".json",{...record,status:"failed"});
    await savePendingBlackRock(chatId,{type:"none",updatedAt:new Date().toISOString()});
    return "شروع دریافت تازه از OneDrive ناموفق بود. هیچ گزارش قدیمی به‌عنوان گزارش تازه ارائه نشد. لطفاً دوباره تلاش کنید.";
  }
  return "در حال دریافت تازه‌ترین مقادیر از OneDrive و همگام‌سازی Snapshot هستم. پس از تأیید، گزارش با قیمت‌های تازه تهیه می‌شود؛ این کار ممکن است چند دقیقه طول بکشد.";
}
async function completeLatestAllocation(req,res){
  if(!syncAuth(req))return res.status(401).json({ok:false});
  const body=req.body||{},id=body.request_id;
  if(typeof id!=="string"||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||typeof body.ok!=="boolean")
    return res.status(400).json({ok:false});
  let record;
  try{
    record=await readPrivateJson(ALLOCATION_REQUEST_PREFIX+id+".json");
    if(!record)return res.status(404).json({ok:false});
    if(record.status!=="queued")return res.status(200).json({ok:true,ignored:true});
    const active=await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+record.chat_id+".json");
    if(active?.request_id!==id)return res.status(200).json({ok:true,ignored:true});
    await writePrivateJson(ALLOCATION_REQUEST_PREFIX+id+".json",{...record,status:"completed"});
  }catch(_){return res.status(500).json({ok:false});}
  waitUntil((async()=>{
    try{
      const state=await loadAccessState();
      if(!hasBotAccess(record.user_id,state))return;
      const guest=!canReadReports(record.user_id,state);
      const includePrivateNotes=isBotAdmin(record.user_id,state);
      const audience=includePrivateNotes?"admin":"report";
      await savePendingBlackRock(record.chat_id,{type:"none",updatedAt:new Date().toISOString()});
      if(!body.ok||Date.now()-Date.parse(record.requested_at)>ALLOCATION_DEADLINE_MS){
        await sendTelegram(record.chat_id,"دریافت تازه ناموفق بود. لطفاً گزارش را دوباره درخواست کنید.",{menu:true,audience:"guest"});return;
      }
      const snapshot=await loadSnapshot();
      const journal=ASSETS.filter(a=>!(a in MANUAL));
      const assets=snapshot?.assets;
      const now=Date.now(),stamp=Date.parse(snapshot?.updated_at);
      if(!assets||Object.keys(assets).length!==23||journal.some(a=>typeof assets[a]!=="number"||!Number.isFinite(assets[a])||assets[a]<0)||
         snapshot.updated_at!==body.snapshot_updated_at||snapshot.workbook_updated_at!==body.workbook_updated_at||
         !Number.isFinite(stamp)||stamp<Date.parse(record.requested_at)||stamp>now||now-stamp>120000)
        throw new Error("verified_snapshot_changed");
      const quantities={...assets,...MANUAL};
      const report=await latestAllocationReport(quantities,guest?null:record.blackRockPriceRial,guest?"chart":record.report_format||"image",snapshot,{guest,includePrivateNotes});
      const latest=await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+record.chat_id+".json");
      if(latest?.request_id!==id)return;
      if(report.text){
        if(guest){
          await sendTelegram(record.chat_id,report.empty?"هیچ گروه دارایی با ارزش قابل گزارش وجود ندارد.":"تهیه نمودار فعلاً ممکن نیست. لطفاً بعداً دوباره تلاش کنید.",{menu:true,audience:"guest"});return;
        }
        if(report.text.includes("قیمت فعلی هر واحد صندوق بلک"))await savePendingBlackRock(record.chat_id,{
          type:"latest_blackrock_price",requestedAt:new Date().toISOString(),request_id:id,report_format:record.report_format||"image"});
        await sendTelegram(record.chat_id,report.text,{menu:true,audience,temporary:report.text.includes("قیمت فعلی هر واحد صندوق بلک")});
      }else if(report.messages){
        await savePendingBlackRock(record.chat_id,{type:"none",updatedAt:new Date().toISOString()});
        for(const text of [...report.messages,report.percentages]){
          const current=await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+record.chat_id+".json");
          if(current?.request_id!==id||!await sendTelegram(record.chat_id,text,{menu:true,audience}))return;
        }
      }else{
        await savePendingBlackRock(record.chat_id,{type:"none",updatedAt:new Date().toISOString()});
        await sendTelegramPhoto(record.chat_id,report.png,guest?"نمودار درصد ترکیب دارایی":(record.report_format==="chart"?"نمودار ترکیب دارایی":"آخرین ترکیب دارایی")+" • مقادیر تازه OneDrive و قیمت‌های تازه بازار"+(report.captionFootnotes?"\n\n"+report.captionFootnotes:""),{guestSafe:guest,audience});
      }
    }catch(_){
      await sendTelegram(record.chat_id,"دریافت تازه یا تهیه گزارش ناموفق بود. لطفاً دوباره تلاش کنید.",{menu:true,audience:"guest"});
    }
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
  return [...new Set(String(process.env.TELEGRAM_ADMIN_USER_IDS||"").split(/[\s,]+/).map(x=>x.trim()).filter(x=>/^[1-9]\d*$/.test(x)&&Number.isSafeInteger(Number(x))))];
}
function isOwner(uid){return adminUserIds().includes(String(uid));}
function isBotAdmin(uid,state){
  uid=String(uid);
  return isOwner(uid)||((state.approved||[]).includes(uid)&&(state.delegatedAdmins||[]).includes(uid));
}
const ACCESS_DAY_MS=24*60*60*1000;
const ACCESS_WEEK_MS=7*ACCESS_DAY_MS;
const APPROVAL_ACTIONS=new Set(["approve","approve_guest","approve_admin","approve_advisor"]);
function accessTerm(uid,state){
  uid=String(uid);
  if(Object.hasOwn(state.accessTerms||{},uid)){
    const term=state.accessTerms[uid];
    if(typeof term?.approved_at!=="string"||typeof term?.expires_at!=="string")return null;
    const approved=Date.parse(term?.approved_at),expires=Date.parse(term?.expires_at);
    return Number.isFinite(approved)&&Number.isFinite(expires)&&expires>approved&&approved<=Date.now()?term:null;
  }
  // Recover approval history without pretending the original attachment or a
  // bounded audit log supplies a date that was never recorded.
  const dates=[state.users?.[uid]?.approvedAt,...(state.audit||[])
    .filter(event=>String(event.target_id)===uid&&APPROVAL_ACTIONS.has(event.action)).map(event=>event.at)]
    .map(value=>Date.parse(value)).filter(value=>Number.isFinite(value)&&value<=Date.now());
  const approved=dates.length?Math.max(...dates):Date.parse(state.accessPolicy?.activated_at);
  if(!Number.isFinite(approved)||approved>Date.now())return null;
  return {approved_at:new Date(approved).toISOString(),expires_at:new Date(approved+ACCESS_WEEK_MS).toISOString(),
    source:dates.length?"approval_history":"policy_activation"};
}
function hasBotAccess(uid,state){
  uid=String(uid);
  if(isBotAdmin(uid,state))return true;
  if(!(state.approved||[]).includes(uid))return false;
  const term=accessTerm(uid,state);
  return !!term&&Date.parse(term.expires_at)>Date.now();
}
function isExpiredMember(uid,state){
  uid=String(uid);
  return !isBotAdmin(uid,state)&&!!(state.expiredUsers?.[uid]||(state.approved||[]).includes(uid)&&!hasBotAccess(uid,state));
}
function canReadReports(uid,state){
  uid=String(uid);
  return isBotAdmin(uid,state)||(hasBotAccess(uid,state)&&(state.financialAdvisors||[]).includes(uid));
}
function roleLabel(uid,state){return isOwner(uid)?"مالک":isBotAdmin(uid,state)?"مدیر":(state.financialAdvisors||[]).includes(String(uid))?"مشاور مالی":"مهمان";}
function emptyAccessState(){return {approved:[],pending:{},delegatedAdmins:[],financialAdvisors:[],users:{},audit:[],accessTerms:{},accessPolicy:null,expiredUsers:{}};}
function removeExpiredGrants(state){
  const removed=state.approved.filter(uid=>!isBotAdmin(uid,state)&&accessTerm(uid,state)&&Date.parse(accessTerm(uid,state).expires_at)<=Date.now());
  for(const uid of removed){
    state.expiredUsers[uid]={expired_at:new Date().toISOString(),expires_at:accessTerm(uid,state).expires_at};
    state.financialAdvisors=state.financialAdvisors.filter(id=>id!==uid);
    delete state.accessTerms[uid];delete state.pending[uid];delete state.users[uid];
  }
  state.approved=state.approved.filter(uid=>!removed.includes(uid));
  state.delegatedAdmins=state.delegatedAdmins.filter(uid=>!removed.includes(uid));
  return removed.length;
}
async function loadAccessState({strict=false,purgeExpired=false,_attempt=0}={}){
  try{
    const r=await get(ACCESS_STATE,ACCESS_READ_OPTIONS);
    if(!r)return emptyAccessState();
    const reader=r.stream.getReader(),chunks=[];
    while(true){const x=await reader.read();if(x.done)break;chunks.push(Buffer.from(x.value));}
    const raw=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!raw||!Array.isArray(raw.approved)||!raw.pending||typeof raw.pending!=="object"||Array.isArray(raw.pending))throw new Error("invalid_access_state");
    for(const field of ["accessTerms","accessPolicy","expiredUsers"]){
      if(raw[field]!==undefined&&raw[field]!==null&&(typeof raw[field]!=="object"||Array.isArray(raw[field])))throw new Error("invalid_access_state");
    }
    const approved=[...new Set(raw.approved.map(String).filter(x=>/^[1-9]\d*$/.test(x)&&Number.isSafeInteger(Number(x))))];
    const state={approved,pending:raw.pending,
      delegatedAdmins:[...new Set((Array.isArray(raw.delegatedAdmins)?raw.delegatedAdmins:[]).map(String))].filter(x=>approved.includes(x)&&!isOwner(x)),
      users:raw.users&&typeof raw.users==="object"&&!Array.isArray(raw.users)?raw.users:{},
      audit:Array.isArray(raw.audit)?raw.audit.slice(-100):[],
      accessTerms:raw.accessTerms&&typeof raw.accessTerms==="object"&&!Array.isArray(raw.accessTerms)?raw.accessTerms:{},
      accessPolicy:raw.accessPolicy&&typeof raw.accessPolicy==="object"&&!Array.isArray(raw.accessPolicy)?raw.accessPolicy:null,
      expiredUsers:raw.expiredUsers&&typeof raw.expiredUsers==="object"&&!Array.isArray(raw.expiredUsers)?raw.expiredUsers:{}};
    state.financialAdvisors=[...new Set((Array.isArray(raw.financialAdvisors)?raw.financialAdvisors:[]).map(String))]
      .filter(id=>approved.includes(id)&&!isOwner(id)&&!state.delegatedAdmins.includes(id));
    Object.defineProperties(state,{_etag:{value:r.blob?.etag},_exists:{value:true}});
    if(purgeExpired&&removeExpiredGrants(state)){
      await saveAccessState(state);
      return loadAccessState({strict,purgeExpired:false});
    }
    return state;
  }catch(error){
    if(error instanceof BlobPreconditionFailedError&&_attempt<2)return loadAccessState({strict,purgeExpired,_attempt:_attempt+1});
    if(strict)throw new Error("access_state_unavailable");
    const state=emptyAccessState();Object.defineProperty(state,"_unavailable",{value:true});return state;
  }
}
async function saveAccessState(state){
  if(state._unavailable||(state._exists&&(!state._etag||state._etag.startsWith("W/"))))throw new Error("access_state_unavailable");
  await put(ACCESS_STATE,JSON.stringify(state,null,2),{access:"private",addRandomSuffix:false,
    ...(state._etag?{ifMatch:state._etag}:{allowOverwrite:false}),contentType:"application/json"});
}
function accessExpirySummary(state){
  const ids=state.approved.filter(id=>!isBotAdmin(id,state));
  return {tracked_non_admin_count:ids.length,active_non_admin_count:ids.filter(id=>hasBotAccess(id,state)).length,
    expired_non_admin_count:ids.filter(id=>!hasBotAccess(id,state)).length,
    persisted_expiry_count:ids.filter(id=>Object.hasOwn(state.accessTerms||{},id)&&accessTerm(id,state)!==null).length,
    removed_expired_count:Object.keys(state.expiredUsers||{}).length,
    activation_date_fallback_count:ids.filter(id=>accessTerm(id,state)?.source==="policy_activation").length};
}
async function configureAccessExpiry(req,res){
  if(!syncAuth(req))return res.status(401).json({ok:false});
  try{
    const state=await loadAccessState({strict:true});
    if(state.accessPolicy&&!Number.isFinite(Date.parse(state.accessPolicy.activated_at)))throw new Error("invalid_policy");
    let changed=false;
    if(!state.accessPolicy){state.accessPolicy={version:1,activated_at:new Date().toISOString()};changed=true;}
    for(const uid of state.approved.filter(id=>!isBotAdmin(id,state))){
      if(!Object.hasOwn(state.accessTerms,uid)){
        const term=accessTerm(uid,state);
        if(!term)throw new Error("invalid_term");
        state.accessTerms[uid]=term;changed=true;
      }
    }
    const apply=req.body?.apply===true;
    if(apply&&changed)await saveAccessState(state);
    // Never broadcast activation, expiry or renewal to affected users.
    return res.status(200).json({ok:true,applied:apply,changed:apply&&changed,
      activated_at:state.accessPolicy.activated_at,...accessExpirySummary(state)});
  }catch(error){return res.status(error instanceof BlobPreconditionFailedError?409:503).json({ok:false,error:"Access expiry configuration unavailable"});}
}
async function notifyCommandActivity(update,message,command,state){
  const uid=String(message?.from?.id||update.callback_query?.from?.id||"");
  // Real Telegram updates carry this stable ID. Never log arbitrary free text,
  // price replies, command arguments or unauthenticated/group requests.
  if(state._unavailable||isBotAdmin(uid,state)||!Number.isSafeInteger(update.update_id)||update.update_id<0)return;
  const match=String(command).match(/^\/[a-z_]{1,64}(?:@[a-z0-9_]+)?(?=\s|$)/i);
  if(!match)return;
  const mode=update.callback_query?String(command).split(" ")[1]:null;
  const label=match[0]+(["text","image","menu"].includes(mode)?" • "+({text:"گزارش متنی",image:"گزارش تصویری",menu:"بازگشت به منو"})[mode]:"");
  const user=message?.from||update.callback_query?.from||state.users[uid]||{};
  const name=[user.first_name,user.last_name].filter(Boolean).join(" ").slice(0,100)||"کاربر";
  const text="<b>فعالیت کاربر</b>\n"+escXml(name)+(user.username?" (@"+escXml(String(user.username).slice(0,32))+")":"")+
    "\nشناسه: "+escXml(uid)+"\nدستور درخواستی: <b>"+escXml(label)+"</b>\nوضعیت دسترسی: "+
    (hasBotAccess(uid,state)?roleLabel(uid,state):"غیرفعال")+"\nزمان: "+boldPortfolioTime(new Date());
  const recipients=[...new Set([...adminUserIds(),...state.delegatedAdmins])];
  await Promise.allSettled(recipients.map(async recipient=>{
    const key="portfolio/command-activity/"+update.update_id+"/"+recipient+".json";
    const attempt=crypto.randomUUID();
    try{
      const previous=await get(key,ACCESS_READ_OPTIONS);
      let record=null;
      if(previous){
        record=await streamJson(previous.stream);
        if(record.status==="delivered"||record.status==="sending"&&record.lease_until>Date.now())return;
        if(!previous.blob?.etag||previous.blob.etag.startsWith("W/"))return;
      }
      await put(key,JSON.stringify({attempt,status:"sending",lease_until:Date.now()+30000}),{
        access:"private",addRandomSuffix:false,contentType:"application/json",
        ...(previous?{ifMatch:previous.blob.etag}:{allowOverwrite:false})});
      let delivered=false;
      for(let retry=0;retry<2&&!delivered;retry++){
        if(!isBotAdmin(recipient,await loadAccessState({strict:true})))break;
        delivered=await deliverTelegram(recipient,"sendMessage",{method:"POST",signal:AbortSignal.timeout(6000),
          headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:Number(recipient),text,parse_mode:"HTML"})},{trackReplies:false});
      }
      const latest=await get(key,ACCESS_READ_OPTIONS);
      const current=latest?await streamJson(latest.stream):null;
      if(current?.attempt===attempt&&latest.blob?.etag&&!latest.blob.etag.startsWith("W/")){
        await put(key,JSON.stringify({attempt,status:delivered?"delivered":"failed"}),{
          access:"private",addRandomSuffix:false,contentType:"application/json",ifMatch:latest.blob.etag});
      }
    }catch(_){console.warn("Command activity notification unavailable");}
  }));
}
async function streamJson(stream){
  const reader=stream.getReader(),chunks=[];
  while(true){const part=await reader.read();if(part.done)break;chunks.push(Buffer.from(part.value));}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function requestAccess(uid,user){
  const state=await loadAccessState({strict:true});
  const adminIds=[...new Set([...adminUserIds(),...state.delegatedAdmins])];
  if(!adminIds.length)return "Access requests are not configured yet. Your Telegram user ID is "+uid+". Ask the bot owner to configure admin access.";
  if(hasBotAccess(uid,state))return "You are already authorised. Send /help to see available commands.";
  state.pending=state.pending||{};
  if(state.pending[uid])return "Your access request is already pending. The bot admin has been notified.";
  state.pending[uid]={id:uid,first_name:String(user.first_name||""),last_name:String(user.last_name||""),username:String(user.username||""),requestedAt:new Date().toISOString()};
  await saveAccessState(state);
  const display=[user.first_name,user.last_name].filter(Boolean).join(" ")||"Telegram user";
  const who=display+(user.username?" (@"+user.username+")":"")+"\nUser ID: "+uid;
  for(const adminId of adminIds){
    await sendTelegramWithKeyboard(adminId,"درخواست دسترسی جدید\n\n"+who,[[{text:"تأیید به‌عنوان مهمان",callback_data:"admin:approve_guest:"+uid},{text:"تأیید به‌عنوان مدیر",callback_data:"admin:approve_admin:"+uid}],
      [{text:"تأیید به‌عنوان مشاور مالی",callback_data:"admin:approve_advisor:"+uid},{text:"رد درخواست",callback_data:"access:reject:"+uid}]],{temporary:false});
  }
  return "Your access request has been sent to the bot admin. You will receive a message when it is reviewed.";
}
async function handleAccessCallback(callback){
  const uid=String(callback.from?.id||""),chat=callback.message?.chat;
  if(chat?.type!=="private"||String(chat.id)!==uid){await answerCallback(callback.id,"دسترسی غیرمجاز.");return;}
  let changed=false;
  try{
    const state=await loadAccessState({strict:true,purgeExpired:true});
    if(isExpiredMember(uid,state)){await answerCallback(callback.id,"");return;}
    if(!isBotAdmin(uid,state)){await answerCallback(callback.id,"دسترسی مدیریت ندارید.");return;}
    const data=String(callback.data||"");
    const previousPanel=callbackPanelToReplace(callback);
    // Old guest price-entry buttons must never reopen the retired relay flow.
    if(data.startsWith("admin:guest_price:")){
      await answerCallback(callback.id,"این گزینه دیگر فعال نیست؛ مهمان می‌تواند نمودار تازه درخواست کند.");return;
    }
    if(data==="admin:main_menu"){
      await answerCallback(callback.id,"");
      await trackPreviousAdminPanel(chat.id,previousPanel);
      await sendMainMenu(chat.id);return;
    }
    const legacy=data.match(/^access:(approve|reject):([1-9]\d*)$/);
    if(legacy){
      if(!state.pending[legacy[2]]){await answerCallback(callback.id,"این درخواست دیگر در انتظار نیست.");return;}
      if(legacy[1]==="approve"){await answerCallback(callback.id,"");await showApprovalRoles(chat.id,legacy[2],previousPanel);return;}
      await changeAccess(uid,legacy[2],legacy[1],state);changed=true;
      await answerCallback(callback.id,"انجام شد.");await showAdminDashboard(chat.id,uid,"home",0,previousPanel);return;
    }
    if(data==="admin:storage_check"){
      await answerCallback(callback.id,"");const result=await verifyAccessStorage();
      await sendTelegramWithKeyboard(chat.id,result.ok?"آزمون ذخیره‌سازی موفق بود: ثبت، بازخوانی و جلوگیری از بازنویسی هم‌زمان تأیید شد.":
        "آزمون ذخیره‌سازی موفق نبود. هیچ مجوز کاربری یا اطلاعات پرتفوی تغییر نکرد.",[adminBack()],{previousPanel});return;
    }
    const page=data.match(/^admin:(home|users|pending|admins|status|audit|expiry)(?::(\d+))?$/);
    if(page){await answerCallback(callback.id,"");await showAdminDashboard(chat.id,uid,page[1],Number(page[2]||0),previousPanel);return;}
    const extension=data.match(/^admin:extend:([1-9]\d*):(1|3|7)$/);
    if(extension){
      await extendUserAccess(uid,extension[1],Number(extension[2]),state,String(callback.id||""));changed=true;
      await answerCallback(callback.id,"مدت دسترسی تمدید شد.");await showAdminDashboard(chat.id,uid,"expiry",0,previousPanel);return;
    }
    const action=data.match(/^admin:(approve_guest|approve_admin|approve_advisor|approve|reject|revoke|confirm_revoke|grant|demote|advisor|guest):([1-9]\d*)$/);
    if(!action){await answerCallback(callback.id,"گزینه نامعتبر.");return;}
    const [_,operation,target]=action;
    if((operation.startsWith("approve")||operation==="reject")&&!state.pending[target])throw new Error("request_not_pending");
    if(operation==="approve"){await answerCallback(callback.id,"");await showApprovalRoles(chat.id,target,previousPanel);return;}
    if(operation==="revoke"){
      validateAccessChange(uid,target,"revoke",state);
      await answerCallback(callback.id,"");
      await sendTelegramWithKeyboard(chat.id,"دسترسی کاربر "+target+" به پرتفوی لغو شود؟",[
        [{text:"بله، لغو دسترسی",callback_data:"admin:confirm_revoke:"+target}],
        [{text:"انصراف",callback_data:"admin:users:0"}]],{previousPanel});return;
    }
    await changeAccess(uid,target,operation==="confirm_revoke"?"revoke":operation,state);changed=true;
    await answerCallback(callback.id,"انجام شد.");await showAdminDashboard(chat.id,uid,"home",0,previousPanel);
  }catch(error){
    const codes=new Set(["access_state_unavailable","access_change_denied","role_change_denied","not_an_admin",
      "owner_permission_required","unknown_user","request_not_pending","unknown_action"]);
    const kind=error instanceof BlobPreconditionFailedError?"precondition_failed":codes.has(error?.message)?error.message:"unexpected_error";
    try{await writePrivateJson("portfolio/diagnostics/last-access-change.json",{at:new Date().toISOString(),
      operation:String(callback.data||"").match(/^admin:(grant|demote|advisor|guest|approve_guest|approve_admin|approve_advisor|confirm_revoke|reject):/)?.[1]||"admin_control",
      kind,committed:changed});}catch(_){}
    await answerCallback(callback.id,changed?"تغییر ثبت شد. برای نمایش وضعیت جدید، پنل را دوباره باز کنید.":
    "عملیات انجام نشد. مجوزها یا وضعیت تغییر کرده است؛ پنل را دوباره باز کنید.");}
}
async function handleAdminAccessCommand(chatId,command,uid){
  let changed=false;
  try{
    const state=await loadAccessState({strict:true,purgeExpired:true});
    if(!isBotAdmin(uid,state)){await sendTelegram(chatId,"دسترسی مدیریت ندارید.",{
      menu:state.approved.includes(uid),removeMenu:!state.approved.includes(uid),audience:"guest"});return;}
    if(/^\/admin(?:@\w+)?$/.test(command)){
      await sendMainMenu(chatId);await showAdminDashboard(chatId,uid);return;
    }
    if(/^\/users(?:@\w+)?$/.test(command)){await showAdminDashboard(chatId,uid,"users");return;}
    const action=command.match(/^\/(approve|revoke)(?:@\w+)?\s+([1-9]\d*)$/);
    if(action){
      if(action[1]==="approve"){
        if(!state.pending[action[2]])throw new Error("request_not_pending");
        await showApprovalRoles(chatId,action[2]);return;
      }
      await changeAccess(uid,action[2],action[1],state);changed=true;await showAdminDashboard(chatId,uid);
    }
  }catch(_){await sendTelegram(chatId,changed?"تغییر ثبت شد. برای نمایش وضعیت جدید، پنل را دوباره باز کنید.":
    "عملیات انجام نشد. پنل را دوباره باز کنید و مجوزها را بررسی کنید.",{menu:true});}
}
function validateAccessChange(actor,target,action,state){
  if(!isBotAdmin(actor,state)||!/^[1-9]\d*$/.test(target)||!Number.isSafeInteger(Number(target))||isOwner(target))throw new Error("access_change_denied");
  if(["grant","demote","advisor","guest"].includes(action)){
    if(actor===target||!state.approved.includes(target))throw new Error("role_change_denied");
    if(action==="demote"&&!state.delegatedAdmins.includes(target))throw new Error("not_an_admin");
  }else if(action==="revoke"){
    if(!state.approved.includes(target)&&!state.pending[target])throw new Error("unknown_user");
    if(!isOwner(actor)&&state.delegatedAdmins.includes(target))throw new Error("owner_permission_required");
  }else if(action==="reject"){
    if(!state.pending[target]||hasBotAccess(target,state))throw new Error("request_not_pending");
  }else if(action==="approve_guest"||action==="approve_admin"||action==="approve_advisor"){
    if(!state.pending[target]||hasBotAccess(target,state))throw new Error("request_not_pending");
  }else throw new Error("unknown_action");
}
async function changeAccess(actor,target,action,state){
  validateAccessChange(actor,target,action,state);
  const wasAdmin=isBotAdmin(target,state),at=new Date().toISOString();
  if(["grant","demote","advisor","guest","revoke"].includes(action))state.financialAdvisors=state.financialAdvisors.filter(id=>id!==target);
  if(action==="advisor"){
    state.delegatedAdmins=state.delegatedAdmins.filter(id=>id!==target);
    state.financialAdvisors.push(target);
  }else if(action==="guest")state.delegatedAdmins=state.delegatedAdmins.filter(id=>id!==target);
  else if(action==="grant")state.delegatedAdmins=[...new Set([...state.delegatedAdmins,target])];
  else if(action==="demote")state.delegatedAdmins=state.delegatedAdmins.filter(x=>x!==target);
  else if(action==="approve_guest"||action==="approve_admin"||action==="approve_advisor"){
    state.approved=[...new Set([...state.approved,target])];
    if(state.pending[target])state.users[target]=state.pending[target];
    state.users[target]={...state.users[target],approvedAt:at};
    delete state.pending[target];delete state.expiredUsers[target];
    if(action==="approve_advisor")state.financialAdvisors.push(target);
    if(action==="approve_admin")state.delegatedAdmins=[...new Set([...state.delegatedAdmins,target])];
  }else{
    if(action==="revoke"){
      state.approved=state.approved.filter(x=>x!==target);
      state.delegatedAdmins=state.delegatedAdmins.filter(x=>x!==target);
      delete state.accessTerms[target];
    }
    delete state.pending[target];
  }
  if((APPROVAL_ACTIONS.has(action)||wasAdmin)&&!isBotAdmin(target,state)&&action!=="revoke"){
    state.accessTerms[target]={approved_at:at,expires_at:new Date(Date.parse(at)+ACCESS_WEEK_MS).toISOString(),
      source:wasAdmin?"admin_demotion":"approval"};
  }
  state.audit.push({at,actor_id:actor,target_id:target,action});
  state.audit=state.audit.slice(-100);
  await saveAccessState(state);
  if(["revoke","demote","guest","advisor"].includes(action)||APPROVAL_ACTIONS.has(action)){
    try{await savePendingBlackRock(target,{type:"none",updatedAt:new Date().toISOString()});}catch(_){}
  }
  const notices={approve_advisor:"دسترسی شما به‌عنوان مشاور مالی تأیید شد؛ فقط گزارش‌های دارایی در دسترس است.",
    advisor:"نقش شما به مشاور مالی تغییر کرد؛ فقط گزارش‌های دارایی در دسترس است.",
    guest:"نقش شما به مهمان تغییر کرد؛ فقط نمودار درصد ترکیب دارایی در دسترس است.",approve_guest:"دسترسی مهمان شما تأیید شد؛ فقط نمودار درصد ترکیب دارایی در دسترس است.",
    approve_admin:"دسترسی شما به‌عنوان مدیر تأیید شد. برای نمایش منو /start را ارسال کنید.",
    reject:"درخواست دسترسی شما رد شد.",revoke:"دسترسی شما به ربات پرتفوی لغو شد.",
    grant:"دسترسی مدیریت برای شما فعال شد. برای نمایش پنل مدیریت /start را ارسال کنید.",
    demote:"نقش شما به مهمان تغییر کرد؛ فقط نمودار درصد ترکیب دارایی در دسترس است."};
  await sendTelegram(Number(target),notices[action],{menu:["grant","approve_guest","approve_admin","approve_advisor","demote","advisor","guest"].includes(action),
    removeMenu:action==="revoke"||action==="reject",audience:"guest"});
}
async function extendUserAccess(actor,target,days,state,requestId){
  if(!isBotAdmin(actor,state)||!state.approved.includes(target)||isBotAdmin(target,state)||![1,3,7].includes(days))throw new Error("access_change_denied");
  if(requestId&&state.audit.some(event=>event.request_id===requestId&&event.actor_id===actor))return;
  const now=Date.now(),old=accessTerm(target,state);
  const expires=Math.max(now,Date.parse(old?.expires_at)||0)+days*ACCESS_DAY_MS;
  state.accessTerms[target]={approved_at:old?.approved_at||new Date(now).toISOString(),expires_at:new Date(expires).toISOString(),source:"admin_extension"};
  state.audit.push({at:new Date(now).toISOString(),actor_id:actor,target_id:target,action:"extend_"+days,request_id:requestId});
  state.audit=state.audit.slice(-100);
  await saveAccessState(state);
  // Renewal is visible in the admin panel only, with no message to the user.
}
async function showApprovalRoles(chatId,target,previousPanel=null){
  const state=await loadAccessState({strict:true});
  if(!isBotAdmin(String(chatId),state)||!state.pending[target])throw new Error("request_not_pending");
  await sendTelegramWithKeyboard(chatId,"نقش کاربر "+target+" را هنگام تأیید انتخاب کنید:",[
    [{text:"تأیید به‌عنوان مهمان",callback_data:"admin:approve_guest:"+target},{text:"تأیید به‌عنوان مدیر",callback_data:"admin:approve_admin:"+target}],
    [{text:"تأیید به‌عنوان مشاور مالی",callback_data:"admin:approve_advisor:"+target},{text:"رد درخواست",callback_data:"admin:reject:"+target}]],{previousPanel});
}
async function memberLabel(id,state){
  let user=state.users[id]||state.pending[id];
  if(!user){
    try{
      const r=await fetch("https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/getChat",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({chat_id:Number(id)}),signal:AbortSignal.timeout(8000)});
      const result=await r.json();if(r.ok&&result.ok)user=result.result;
    }catch(_){}
  }
  const name=[user?.first_name,user?.last_name].filter(Boolean).join(" ").slice(0,70);
  return (name||"کاربر")+(user?.username?" (@"+String(user.username).slice(0,32)+")":"")+" • "+id;
}
const ADMIN_PAGE_SIZE=8;
const adminBack=()=>[{text:"بازگشت به پنل",callback_data:"admin:home"}];
async function showAdminDashboard(chatId,uid,section="home",page=0,previousPanel=null){
  const state=await loadAccessState({strict:true,purgeExpired:true});
  if(!isBotAdmin(uid,state))throw new Error("admin_permission_required");
  const owner=isOwner(uid);
  if(section==="home"){
    const buttons=[[{text:"کاربران مجاز",callback_data:"admin:users:0"},{text:"درخواست‌های دسترسی",callback_data:"admin:pending:0"}],
      [{text:"وضعیت سامانه",callback_data:"admin:status"},{text:"رویدادهای مدیریت",callback_data:"admin:audit"}]];
    buttons.push([{text:"مدیریت نقش‌ها",callback_data:"admin:admins:0"}]);
    buttons.push([{text:"پایش زمان دسترسی",callback_data:"admin:expiry:0"}]);
    await sendTelegramWithKeyboard(chatId,"پنل مدیریت • "+(owner?"مالک":"مدیر منتخب")+
      "\n\nکاربران مجاز: "+new Set([...state.approved.filter(id=>hasBotAccess(id,state)),...adminUserIds()]).size+
      "\nدرخواست‌های در انتظار: "+Object.keys(state.pending).length+
      "\nمشاوران مالی: "+state.financialAdvisors.filter(id=>hasBotAccess(id,state)).length+"\nمدیران منتخب: "+state.delegatedAdmins.length+
      "\nدسترسی‌های منقضی: "+accessExpirySummary(state).expired_non_admin_count,buttons,{previousPanel});return;
  }
  if(section==="status"){
    const snapshot=await safeSnapshot(),status=quantitySnapshotStatus(snapshot);
    const active=await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+chatId+".json");
    const job=active?.request_id?await readPrivateJson(ALLOCATION_REQUEST_PREFIX+active.request_id+".json"):null;
    const queued=job?.status==="queued"&&Date.now()-Date.parse(job.requested_at)<ALLOCATION_DEADLINE_MS;
    const expired=job?.status==="queued"&&!queued;
    await sendTelegramWithKeyboard(chatId,"وضعیت سامانه\n\nذخیره‌سازی دسترسی: متصل\nSnapshot مقادیر: "+
      (snapshot?(status.stale?"قدیمی یا نامعتبر":"به‌روز"):"موجود نیست")+
      "\nتعداد دارایی‌های همگام‌شده: "+Object.keys(snapshot?.assets||{}).length+" از ۲۳"+
      "\nآخرین همگام‌سازی (تهران): "+boldPortfolioTime(snapshot?.updated_at)+
      "\nآخرین تغییر فایل (تهران): "+boldPortfolioTime(snapshot?.workbook_updated_at)+
      "\nدریافت مستقل OneDrive: "+(process.env.GITHUB_ACTIONS_TOKEN?"پیکربندی شده":"پیکربندی نشده")+
      "\nاحراز هویت وب‌هوک: "+(process.env.TELEGRAM_WEBHOOK_SECRET?"پیکربندی شده":"پیکربندی نشده")+
      "\nدرخواست آخر شما: "+(queued?"در حال دریافت":expired?"منقضی شده؛ دوباره درخواست دهید":job?.status==="failed"?"ناموفق":job?.status==="completed"?"پاسخ همگام‌سازی دریافت شده":"درخواستی ثبت نشده")+
      "\n\nوضعیت قیمت‌های بازار هنگام درخواست هر گزارش بررسی می‌شود.",[
      [{text:"بررسی دوباره",callback_data:"admin:status"},{text:"آزمون ذخیره‌سازی",callback_data:"admin:storage_check"}],adminBack()],{previousPanel,html:true});return;
  }
  if(section==="audit"){
    const labels={extend_1:"تمدید یک‌روزه",extend_3:"تمدید سه‌روزه",extend_7:"تمدید یک‌هفته‌ای",approve_advisor:"تأیید مشاور مالی",advisor:"تغییر به مشاور مالی",guest:"تغییر به مهمان",approve:"تأیید دسترسی",approve_guest:"تأیید مهمان",approve_admin:"تأیید مدیر",reject:"رد درخواست",revoke:"لغو دسترسی",grant:"ارتقا به مدیر",demote:"تغییر نقش به مهمان"};
    const lines=state.audit.slice(-10).reverse().map(event=>
      boldPortfolioTime(event.at)+" • "+(labels[event.action]||"تغییر دسترسی")+
      "\nکاربر: "+escXml(event.target_id)+" • مدیر: "+escXml(event.actor_id));
    await sendTelegramWithKeyboard(chatId,"آخرین رویدادهای مدیریت (تهران)\n\n"+(lines.join("\n\n")||"رویدادی ثبت نشده است."),[adminBack()],{previousPanel,html:true});return;
  }
  const ids=section==="pending"?Object.keys(state.pending):section==="admins"?state.approved.filter(id=>!isOwner(id)):
    [...new Set([...adminUserIds(),...state.approved])];
  page=Math.max(0,Math.min(Math.floor(page),Math.max(0,Math.ceil(ids.length/ADMIN_PAGE_SIZE)-1)));
  const selected=ids.slice(page*ADMIN_PAGE_SIZE,(page+1)*ADMIN_PAGE_SIZE);
  const names=await Promise.all(selected.map(id=>memberLabel(id,state)));
  const title=section==="expiry"?"پایش زمان دسترسی":section==="pending"?"درخواست‌های دسترسی":section==="admins"?"مدیریت نقش‌ها":"کاربران مجاز";
  const lines=[],keyboard=[];
  selected.forEach((id,i)=>{
    const role=roleLabel(id,state);
    const label=(i+1)+". "+names[i]+(section==="pending"?"":" • "+role+(!hasBotAccess(id,state)?" • دسترسی غیرفعال":""));
    if(section==="expiry"){
      const term=accessTerm(id,state),remaining=Date.parse(term?.expires_at)-Date.now();
      const status=isBotAdmin(id,state)?"بدون محدودیت زمانی":remaining>0?
        "زمان باقی‌مانده: "+reportNumber(Math.floor(remaining/ACCESS_DAY_MS))+" روز و "+reportNumber(Math.floor(remaining/(60*60*1000))%24)+" ساعت و "+reportNumber(Math.floor(remaining/60000)%60)+" دقیقه":
        term?"منقضی • دسترسی غیرفعال":"دسترسی غیرفعال • تاریخ تأیید ثبت نشده";
      lines.push(escXml(label)+"\n"+status+(!isBotAdmin(id,state)&&term?"\nپایان دسترسی: "+boldPortfolioTime(term.expires_at):""));
      if(!isBotAdmin(id,state))keyboard.push([1,3,7].map(days=>({text:"تمدید "+reportNumber(i+1)+" • "+(days===7?"یک هفته":reportNumber(days)+" روز"),callback_data:"admin:extend:"+id+":"+days})));
    }else lines.push(label);
    if(section==="pending")keyboard.push(
      [{text:"تأیید مهمان "+(i+1),callback_data:"admin:approve_guest:"+id},{text:"تأیید مدیر "+(i+1),callback_data:"admin:approve_admin:"+id}],
      [{text:"تأیید مشاور مالی "+(i+1),callback_data:"admin:approve_advisor:"+id},{text:"رد "+(i+1),callback_data:"admin:reject:"+id}]);
    else if(section==="admins"&&id!==uid){
      const buttons=[];
      if(role!=="مدیر")buttons.push({text:"ارتقا به مدیر "+(i+1),callback_data:"admin:grant:"+id});
      if(role!=="مشاور مالی")buttons.push({text:"مشاور مالی "+(i+1),callback_data:"admin:advisor:"+id});
      if(role!=="مهمان")buttons.push({text:"تغییر به مهمان "+(i+1),callback_data:"admin:"+(role==="مدیر"?"demote":"guest")+":"+id});
      keyboard.push(buttons);
    }
    else if(section!=="expiry"&&!isOwner(id)&&(owner||!state.delegatedAdmins.includes(id)))keyboard.push([{text:"لغو دسترسی "+(i+1),callback_data:"admin:revoke:"+id}]);
  });
  const navigation=[];
  if(page>0)navigation.push({text:"صفحه قبل",callback_data:"admin:"+section+":"+(page-1)});
  if((page+1)*ADMIN_PAGE_SIZE<ids.length)navigation.push({text:"صفحه بعد",callback_data:"admin:"+section+":"+(page+1)});
  if(navigation.length)keyboard.push(navigation);
  keyboard.push(adminBack());
  await sendTelegramWithKeyboard(chatId,title+"\nصفحه "+(page+1)+"\n\n"+(lines.join("\n\n")||"موردی وجود ندارد.")+
    (section==="admins"?"\n\nمهمان فقط نمودار درصدی را می‌بیند؛ مشاور مالی فقط گزارش‌ها را می‌بیند. نقش مالک و نقش خودتان قابل تغییر نیست.":""),keyboard,{previousPanel,html:section==="expiry"});
}
function callbackPanelToReplace(callback){
  const message=callback.message;
  const botId=String(process.env.TELEGRAM_BOT_TOKEN||"").split(":")[0];
  if(!message?.from?.is_bot||String(message.from.id)!==botId||
    !Number.isSafeInteger(message.message_id)||message.message_id<=0||
    !message.reply_markup?.inline_keyboard?.flat().some(button=>button.callback_data===callback.data))return null;
  return {message_id:message.message_id,created_at:message.date?
    new Date(message.date*1000).toISOString():new Date().toISOString()};
}
async function trackPreviousAdminPanel(chatId,previousPanel){
  if(previousPanel){
    try{
      const key=TEMPORARY_REPLY_PREFIX+chatId+".json";
      const state=await readPrivateJson(key)||{lastDeliveredId:0,messages:[]};
      if(!state.messages.some(item=>item.message_id===previousPanel.message_id)){
        state.messages.push(previousPanel);await writePrivateJson(key,state);
      }
    }catch(_){console.warn("Previous admin panel tracking unavailable");}
  }
}
async function sendTelegramWithKeyboard(chatId,text,inlineKeyboard,{temporary=true,previousPanel=null,html=false}={}){
  if(!isBotAdmin(String(chatId),await loadAccessState()))return false;
  await trackPreviousAdminPanel(chatId,previousPanel);
  try{if(!isBotAdmin(String(chatId),await loadAccessState({strict:true})))return false;}catch(_){return false;}
  const keyboard=temporary?[...inlineKeyboard,[{text:"بازگشت به منوی اصلی",callback_data:"admin:main_menu"}]]:inlineKeyboard;
  return deliverTelegram(chatId,"sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text,...(html?{parse_mode:"HTML"}:{}),reply_markup:{inline_keyboard:keyboard}})},{temporary});
}
async function sendMainMenu(chatId){
  await sendTelegram(chatId,"منوی اصلی پرتفوی\nبرای انتخاب گزارش، از دکمه‌های زیر استفاده کنید.",{menu:true,menuAnchor:true,audience:"guest"});
}
async function answerCallback(callbackId,text){
  const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)return;
  try{await fetch("https://api.telegram.org/bot"+token+"/answerCallbackQuery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({callback_query_id:callbackId,text})});}
  catch(_){console.warn("Telegram callback answer unavailable");}
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

const ECOCOACH_FUND_URL="https://ecocoach.net/blackrock-index";
// Owner-authorized fallback for guest charts only; this is not a market quote.
const GUEST_ECOCOACH_PRICE_TOMAN=1030000;
const GUEST_ECOCOACH_PRICE_RIAL=GUEST_ECOCOACH_PRICE_TOMAN*10;
function parseEcoCoachPrice(html,now=Date.now()){
  // Accept only an explicitly labelled per-unit quote on the observed fund page.
  // Marketing figures, return charts, total NAV and another BlackRock are ignored.
  const clean=String(html).replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,"");
  const plain=text=>text.replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ").trim();
  if(!/(صندوق\s+(?:شاخصی\s+)?بلک\s*راک|EcoCoach\s+BlackRock)/i.test(plain(clean)))throw new Error("ECOCOACH_PRICE_UNAVAILABLE");
  const candidates=[];
  for(const table of clean.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
    const caption=table[1].match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    if(!caption||!/(صندوق\s+(?:شاخصی\s+)?بلک\s*راک|EcoCoach\s+BlackRock)/i.test(plain(caption[1])))continue;
    if(/نمونه|فرضی|آزمایشی|example|demo|hypothetical|backtest|coming soon|BlackRock Inc|NYSE|iShares/i.test(plain(table[1])))continue;
    const quotes=[],dates=[];
    for(const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(match=>plain(match[1]));
      if(cells.length!==2||!/^(?:قیمت|ارزش|NAV)\s*(?:فعلی\s*)?(?:هر\s*)?واحد(?:\s*(?:صندوق)\s*)?$/i.test(cells[0]))continue;
      const match=cells[1].match(/^([۰-۹٠-٩\d][۰-۹٠-٩\d,٬.٫]*)\s*(تومان|ریال|IRT|IRR)$/i);
      if(!match)continue;
      const numeric=match[1].replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
        .replace(/[٠-٩]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/٬/g,",").replace(/٫/g,".");
      if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(numeric))continue;
      const value=parseNum(numeric),price=value*(/^(تومان|IRT)$/i.test(match[2])?10:1);
      if(value!==null&&Number.isFinite(price)&&price>0&&price<=Number.MAX_SAFE_INTEGER)quotes.push(price);
    }
    for(const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const label=plain(row[1]);
      if(!/(تاریخ|زمان).*(?:قیمت|به[‌\s-]*روزرسانی)|(?:Price as of|Price updated)/i.test(label))continue;
      for(const time of row[1].matchAll(/<time\b[^>]*datetime=["']([^"']+)["']/gi)){
        if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(time[1]))dates.push(time[1]);
      }
    }
    const amounts=[...new Set(quotes)],stamps=[...new Set(dates.map(date=>Date.parse(date)))];
    const age=now-stamps[0];
    if(amounts.length===1&&stamps.length===1&&Number.isFinite(age)&&age>=0&&age<=24*60*60*1000)
      candidates.push({price:amounts[0],stamp:stamps[0]});
  }
  const distinct=[...new Map(candidates.map(candidate=>[candidate.price+"|"+candidate.stamp,candidate])).values()];
  if(distinct.length!==1)throw new Error("ECOCOACH_PRICE_UNAVAILABLE");
  return {priceRial:distinct[0].price,source:"EcoCoach",sourceUrl:ECOCOACH_FUND_URL,
    quotedAt:new Date(distinct[0].stamp).toISOString(),retrievedAt:new Date(now).toISOString(),unit:"IRR/unit"};
}
async function ecoCoachPrice(){
  const response=await fetch(ECOCOACH_FUND_URL,{headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html"},
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("ECOCOACH_PRICE_UNAVAILABLE");
  const html=await response.text();
  if(html.length>1000000)throw new Error("ECOCOACH_PRICE_UNAVAILABLE");
  return parseEcoCoachPrice(html);
}
async function getPrices({includeEcoCoach=true}={}){
  const prices={};
  const errors={};
  const goldDefs={
    "شمش نقره 999":{imeSilver:true,unit:"IRR/g"},
    "سکه تمام":{slug:"sekee",range:[1000000000,10000000000],unit:"IRR/coin"},
    "ربع سکه بانکی":{slug:"rob",range:[500000000,1500000000],unit:"IRR/coin"},
    "ربع سکه غیره":{gold18Quarter:true,unit:"IRR/coin"},
    "آبشده (طلب)":{slug:"geram18",range:[100000000,1000000000],unit:"IRR/g"},
    "آبشده (شمش زربد)":{slug:"geram18",range:[100000000,1000000000],unit:"IRR/g"},
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
      prices[asset]={...p,unit:d.unit};
    }catch(e){errors[asset]=e.message;console.error("Gold/metal price failed:",asset,e.message);}
  });
  jobs.push(...Object.keys(LISTED).map(async asset=>{
    try{prices[asset]=await getListedPrice(asset,marketHtmls);}catch(e){errors[asset]=e.message;}
  }));
  if(includeEcoCoach)jobs.push((async()=>{
    try{prices["بلک راک"]=await ecoCoachPrice();}catch(_){errors["بلک راک"]="USER_INPUT_REQUIRED";}
  })());
  try{
    const ids=Object.values(CRYPTO_IDS).join(",");
    const data=await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids="+encodeURIComponent(ids)+"&vs_currencies=usd");
    for(const [asset,id] of Object.entries(CRYPTO_IDS)){
      const p=parseNum(data?.[id]?.usd);
      if(p===null)errors[asset]="Crypto price unavailable"; else prices[asset]={priceUsd:p,source:"CoinGecko",retrievedAt:new Date().toISOString(),unit:"USD"};
    }
  }catch(e){for(const asset of Object.keys(CRYPTO_IDS))errors[asset]="CoinGecko unavailable";}
  await Promise.all(jobs);
  return {prices,errors};
}

function valueRial(asset,qty,p,usdIrr){
  if(["BTC","ETH","Tether","Link","ADA","SOL","ONDO"].includes(asset))return qty*p.priceUsd*usdIrr;
  if(asset==="دلار")return qty*p.priceRial;
  return qty*p.priceRial;
}

async function valuationReply(q,names,title,snapshot=null,noteOptions={}){
  const {prices,errors}=await getPrices({includeEcoCoach:names.includes("بلک راک")});
  const usdIrr=prices["دلار"]?.priceRial;
  if(!Number.isFinite(usdIrr)||usdIrr<=0)return "<b>"+escXml(title)+"</b>\n\nدریافت نرخ دلار آزاد ناموفق بود؛ ارزش‌گذاری انجام نشد.";
  const blocks=[],shown=[];let total=0,incomplete=false;
  names.forEach(asset=>{
    let missing=errors[asset]||!prices[asset]?"قیمت معتبر دریافت نشد":null;
    if(q[asset]===undefined||!Number.isFinite(Number(q[asset]))||Number(q[asset])<0)missing="مقدار دارایی موجود یا معتبر نیست";
    const value=missing?null:valueRial(asset,Number(q[asset]),prices[asset],usdIrr);
    if(!missing&&(!Number.isFinite(value)||value<0))missing="ارزش‌گذاری معتبر نیست";
    if(missing){
      incomplete=true;
      shown.push(asset);
      blocks.push(reportNumber(shown.length)+". <b>"+escXml(assetLabel(asset,noteOptions))+"</b>\nارزش‌گذاری انجام نشد: "+missing);
    }else{
      if(value>=MIN_REPORT_VALUE_RIAL){total+=value;shown.push(asset);blocks.push(detailedAssetTextBlock(q,asset,shown.length-1,prices[asset],value,noteOptions));}
    }
  });
  const header="<b>گزارش تفصیلی "+escXml(title)+"</b>\n"+
    (snapshot?"آخرین همگام‌سازی مقادیر: "+boldPortfolioTime(snapshot.updated_at)+"\n":"")+
    "قیمت‌های بازار: "+boldPortfolioTime(new Date())+"\n"+
    (incomplete||!Number.isFinite(total)?"<b>گزارش ناقص است؛ جمع کل ارائه نمی‌شود.</b>":
      "ارزش کل دارایی‌های این گزارش: <b>"+formatTomanAmount(total/10)+" تومان</b>");
  return withAssetFootnotes([header,...(blocks.length?blocks:["هیچ دارایی با ارزش حداقل ۵۰،۰۰۰ تومان در این گزارش وجود ندارد."])].join("\n\n"),shown,noteOptions);
}
function reportNumber(value){return Number(value).toLocaleString("fa-IR",{maximumFractionDigits:8});}
function detailedAssetTextBlock(q,asset,index,quote,value,noteOptions={}){
  const unit=cryptoAsset(asset)?asset:asset==="دلار"?"دلار":REPORT_UNIT[asset];
  const price=quote.priceUsd!==undefined?monetaryNumber(quote.priceUsd)+" دلار":formatTomanAmount(quote.priceRial/10)+" تومان";
  return reportNumber(index+1)+". <b>"+escXml(assetLabel(asset,noteOptions))+"</b>\n"+
    "مقدار: "+reportNumber(q[asset])+" "+escXml(unit)+" • گروه: "+escXml(REPORT_GROUP[asset])+"\n"+
    "ارزش: <b>"+formatTomanAmount(value/10)+" تومان</b>\n"+
    "قیمت واحد: "+price+" • منبع: "+escXml(sourceFa(quote.source));
}
function splitAssetReportParagraphs(text){
  const chunks=[];let chunk="";
  for(const paragraph of text.split("\n\n")){
    if((chunk+"\n\n"+paragraph).length>3500&&chunk){
      chunks.push(chunk);chunk="<b>ادامه گزارش</b>";
    }
    chunk+=(chunk?"\n\n":"")+paragraph;
  }
  if(chunk)chunks.push(chunk);
  return chunks;
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
function portfolioTable(q,vals,total,prices,usdIrr,noteOptions={}){
  const header=["#","گروه","دارایی","مقدار","واحد","قیمت واحد","ارزش کل تومان","ارزش کل دلار","%","منبع"];
  const categoryRank={"طلا و سکه":0,"نقره":1,"سهام و صندوق":2,"رمز ارز":3,"Tether":4,"US Dollar":5};
  const subgroupRank={
    "سکه تمام":0,"ربع سکه غیره":0,"ربع سکه بانکی":0,"آبشده (طلب)":0,"آبشده (شمش زربد)":0,
    "طلا":1,"عیار":1,"گوهر":1,"آلتون":1,"امرالد":1,"زرفام":1,
    "شمش نقره 999":0,
    "سهام":0,"صندوق سهامی":1,"صندوق بخشی":2,"صندوق کالایی":3,"صندوق طلا":4,"صندوق":5,
    "رمز ارز":0,"فیات":0
  };
  const rows=Object.entries(vals).filter(([,value])=>value>=MIN_REPORT_VALUE_RIAL).sort((a,b)=>{
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
    return [String(i+1),REPORT_GROUP[a]||"-",assetLabel(a,noteOptions),format(qty),REPORT_UNIT[a]||"-",unit,formatTomanAmount(v/10,{persian:false}),format(valueUsd(v,usdIrr)),(v/total*100).toFixed(1)+"%",p.source||"-"];
  });
  const widths=header.map((h,i)=>Math.max(h.length,...rows.map(r=>r[i].length)));
  const line=r=>r.map((x,i)=>String(x).padEnd(widths[i]," ")).join(" | ");
  return "<pre>"+line(header)+"\n"+rows.map(line).join("\n")+"</pre>";
}
async function allocationReply(q,blackRockPriceRial=null,noteOptions={}){
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
  if(blackRockPriceRial!==null&&!prices["بلک راک"]){
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
    return withAssetFootnotes("Portfolio valuation needs one additional input.\n\nPlease send the current EcoCoach "+assetLabel("بلک راک")+" price per unit in toman.\nQuantity: "+format(q["بلک راک"]||0)+" units\n\nExample: 850000",["بلک راک"],noteOptions);
  }
  if(!total)return "Allocation unavailable: no current prices were obtained.";
  const reportPrices={...prices};
  if(blackRockPriceRial!==null&&!prices["بلک راک"]) reportPrices["بلک راک"]={priceRial:blackRockPriceRial,source:"User input",retrievedAt:new Date().toISOString(),unit:"IRR/unit"};
  const selected=filteredReportValues(vals);total=selected.total;
  if(!total)return "هیچ دارایی با ارزش حداقل ۵۰،۰۰۰ تومان در گزارش وجود ندارد.";
  const table=portfolioTable(q,selected.vals,total,reportPrices,usdIrr,noteOptions);
  const sources=[...new Set(Object.keys(vals).map(a=>reportPrices[a]?.source).filter(Boolean))].join(", ");
  const lines=["<b>Portfolio valuation — live prices</b>","","<b>Total:</b> "+formatToman(total)+" | <b>USD:</b> $"+format(valueUsd(total,usdIrr)),"",table];
  if(missing.length)lines.push("\n<b>Not valued:</b> "+missing.map(asset=>assetLabel(asset,noteOptions)).join(", "));
  lines.push("\n<b>Price sources:</b> "+sources);
  lines.push("<b>Retrieved:</b> "+boldPortfolioTime(new Date()));
  return withAssetFootnotes(lines.join("\n"),[...visibleReportAssets(vals),...missing],noteOptions);
}


function cryptoAsset(asset){return ["BTC","ETH","Tether","Link","ADA","SOL","ONDO"].includes(asset);}
function qSafe(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function sourceFa(s){
  const m={"CoinGecko":"CoinGecko","Shakhesban":"شاخص‌بان","Shakhesban IME":"شاخص‌بان (بورس کالا)","TGJU":"TGJU","EcoCoach":"اکوکوچ","User input":"ورودی کاربر","TGJU 18K gold × quarter-coin weight":"TGJU × وزن ربع سکه"};
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
const ALLOCATION_CATEGORIES=["طلا و سکه","نقره","سهام و صندوق","رمز ارز","Tether","US Dollar"];
const ALLOCATION_LABELS={"طلا و سکه":"طلا و سکه","نقره":"نقره","سهام و صندوق":"سهام و صندوق‌ها","رمز ارز":"رمزارز","Tether":"تتر","US Dollar":"دلار نقدی"};
const ALLOCATION_COLORS={"طلا و سکه":"#e9c51d","نقره":"#8799a8","سهام و صندوق":"#4c79b7","رمز ارز":"#e15353","Tether":"#00a767","US Dollar":"#98c87c"};
function allocationGroups(vals,total){
  ({vals,total}=filteredReportValues(vals));
  return ALLOCATION_CATEGORIES.map(category=>{
    const value=Object.entries(vals).filter(([asset])=>categoryName(asset)===category).reduce((sum,[,amount])=>sum+amount,0);
    return {category,label:ALLOCATION_LABELS[category],value,percentage:total>0?value/total*100:0};
  });
}
async function filteredAssetsReply(quantities,snapshot,noteOptions={}){
  // Without verified current quantities, retain the raw quantity list and do
  // not decide visibility using stale valuations or historical purchase notes.
  if(quantitySnapshotStatus(snapshot).stale)return assetsReply(quantities,snapshot,noteOptions);
  const {prices,errors}=await getPrices({includeEcoCoach:Number(quantities["بلک راک"])>0});
  const usdIrr=prices["دلار"]?.priceRial;
  const shown=ASSETS.filter(asset=>{
    const qty=Number(quantities[asset]);
    if(quantities[asset]===undefined||!Number.isFinite(qty)||qty<0)return true;
    if(qty===0)return false;
    if(errors[asset]||!prices[asset]||(cryptoAsset(asset)&&(!Number.isFinite(usdIrr)||usdIrr<=0)))return true;
    const value=valueRial(asset,qty,prices[asset],usdIrr);
    if(!Number.isFinite(value)||value<0)return true;
    return value>=MIN_REPORT_VALUE_RIAL;
  });
  return assetsReply(quantities,snapshot,{...noteOptions,shown});
}
function assetsReply(quantities,snapshot,{shown=ASSETS,includePrivateNotes=false}={}){
  const noteOptions={includePrivateNotes};
  const categories=[
    ["طلا و سکه","طلا و سکه"],["نقره","نقره"],["سهام و صندوق","سهام و صندوق‌ها"],
    ["رمز ارز","رمزارزها"],["Tether","تتر"],["US Dollar","دلار"]
  ];
  let index=0;
  const sections=categories.filter(([category])=>shown.some(asset=>categoryName(asset)===category))
    .map(([category,title])=>"<b><i><u>"+escXml(title)+"</u></i></b>\n\n"+shown
      .filter(asset=>categoryName(asset)===category)
      .map(asset=>(++index)+". "+assetLabel(asset,noteOptions)+": "+(quantities[asset]===undefined?"همگام‌سازی نشده":format(quantities[asset])))
      .join("\n"));
  return withAssetFootnotes("دارایی‌های پرتفوی ("+reportNumber(shown.length)+" مورد)\n\n"+
    (sections.join("\n\n")||"هیچ دارایی با ارزش حداقل ۵۰،۰۰۰ تومان وجود ندارد.")+
    (snapshot?"\n\nSnapshot: "+boldPortfolioTime(snapshot.updated_at):""),shown,noteOptions);
}

function escXml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function svgText(x,y,text,size,opts={}){
  const anchor=opts.anchor||"start",weight=opts.weight||400,fill=opts.fill||"#18324a";
  return '<text x="'+x+'" y="'+y+'" font-family="Estedad" font-size="'+size+'" font-weight="'+weight+'" fill="'+fill+'" text-anchor="'+anchor+'">'+escXml(text)+"</text>";
}
function monetaryNumber(value,{persian=true,decimals=8,fixed=false}={}){
  const number=decimals===0?Math.round(Number(value)):Number(value);
  const text=number.toLocaleString(persian?"fa-IR":"en-US",{
    maximumFractionDigits:decimals,minimumFractionDigits:fixed?decimals:0});
  return persian?text.replace(/٬/g,"،").replace(/٫/g,"/"):text;
}
function formatTomanAmount(value,{persian=true}={}){return monetaryNumber(value,{persian,decimals:0});}
function compactNumber(n){return monetaryNumber(n,{decimals:2});}
function moneyFa(n){return formatTomanAmount(n)+" تومان";}
function usdFa(n){return "$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:2});}
function wrapReportText(text,maxChars=145){
  const lines=[];let line="";
  for(const word of String(text).split(/\s+/)){
    if(line&&(line+" "+word).length>maxChars){lines.push(line);line="";}
    line+=(line?" ":"")+word;
  }
  if(line)lines.push(line);
  return lines;
}

function buildPortfolioSvg(q,vals,total,prices,usdIrr,noteOptions={}){
  ({vals,total}=filteredReportValues(vals));
  const priceTime=portfolioTime(new Date());
  const enNum=n=>Number(n).toLocaleString("fa-IR",{maximumFractionDigits:2});
  const toman=moneyFa;
  const usdText=n=>monetaryNumber(n,{decimals:2,fixed:true})+" دلار";
  const unitPriceFa=(asset,p)=>cryptoAsset(asset)
    ? monetaryNumber(p.priceUsd)+" دلار"
    : formatTomanAmount(p.priceRial/10)+" تومان";
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
  const rows=Object.entries(vals).filter(([,value])=>value>=MIN_REPORT_VALUE_RIAL).sort((a,b)=>{
    const ga=categoryRank[categoryName(a[0])]??99,gb=categoryRank[categoryName(b[0])]??99;
    if(ga!==gb)return ga-gb;
    const sa=subgroupRank(a[0]),sb=subgroupRank(b[0]);
    return sa-sb || b[1]-a[1];
  }).map(([a,v],i)=>{
    const p=prices[a]||{};
    const crypto=cryptoAsset(a);
    const usd=crypto?qSafe(q[a])*qSafe(p.priceUsd):(a==="دلار"?qSafe(q[a]):valueUsd(v,usdIrr));
    return {
      rank:i+1,asset:a,group:REPORT_GROUP[a]||"-",
      qty:qSafe(q[a]),qtyDecimals:a==="ETH"?3:a==="BTC"?4:null,unit:cryptoAsset(a)?a:REPORT_UNIT[a]||"-",
      unitPrice:unitPriceFa(a,p),valueToman:v/10,valueUsd:usd,pct:total?v/total*100:0,
      source:sourceFa(p.source)
    };
  });

  // The table is deliberately placed BELOW the dashboard panels. This prevents
  // the 29-row table from ever covering the chart, cards, or summary.
  const noteY=790+48+rows.length*37+54;
  const noteLines=assetCommentEntries(rows.map(row=>row.asset),noteOptions)
    .flatMap(({label,comment})=>wrapReportText(label+": "+comment));
  const noteH=noteLines.length?80+noteLines.length*28:0;
  const W=1800,H=noteY+noteH+40;
  const tableX=40,tableW=1720,rowH=37,headerY=790,headerH=48;
  const cols=[
    ["rank","ردیف",45],["asset","دارایی",245],["group","گروه",175],["qty","مقدار",105],["unit","واحد",100],
    ["unitPrice","قیمت واحد",205],["valueToman","ارزش (تومان)",250],["valueUsd","ارزش (دلار)",205],["pct","درصد",70],["source","منبع",320]
  ];
  let cx=tableX+tableW;const xmap={};for(const [k,,w] of cols){cx-=w;xmap[k]=cx;}

  const cats={};
  for(const [a,v] of Object.entries(vals)){
    const k=categoryName(a);
    cats[k]=(cats[k]||0)+v;
  }
  const catOrder=["طلا و سکه","نقره","سهام و صندوق","رمز ارز","Tether","US Dollar"];
  const catColors=ALLOCATION_COLORS;
  const catEn=ALLOCATION_LABELS;

  // Conservative text truncation keeps every cell inside its column.
  const fit=(text,width,font=13)=>{
    const s=String(text??"");
    const max=Math.max(4,Math.floor((width-16)/(font*0.58)));
    return s.length<=max?s:s.slice(0,Math.max(1,max-1))+"…";
  };

  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'"><rect width="100%" height="100%" fill="#f7fafc"/>';
  svg+='<rect x="20" y="20" width="1760" height="245" rx="22" fill="#123b5d"/>';
  svg+=svgText(1730,78,"گزارش ارزش‌گذاری و ترکیب دارایی",38,{anchor:"end",weight:700,fill:"#ffffff"});
  svg+=svgText(1730,120,"قیمت‌های زنده بازار • "+priceTime,21,{anchor:"end",weight:700,fill:"#dce9f4"});
  svg+=svgText(70,78,toman(total/10),34,{anchor:"start",weight:700,fill:"#ffffff"});
  svg+=svgText(70,120,usdText(valueUsd(total,usdIrr)),25,{anchor:"start",fill:"#dce9f4"});
  svg+=svgText(70,160,"قیمت دلار: "+formatTomanAmount(usdIrr/10)+" تومان",18,{anchor:"start",fill:"#dce9f4"});
  svg+=svgText(70,200,"قیمت واحد رمزارزها به دلار است",18,{anchor:"start",fill:"#dce9f4"});

  const cards=catOrder.map(name=>[name,cats[name]||0]);
  let cardX=20;
  for(const [name,val] of cards){
    const pct=total?val/total*100:0;
    const cardW=285;
    const cardToman=formatTomanAmount(val/10);
    svg+='<rect x="'+cardX+'" y="285" width="'+cardW+'" height="105" rx="16" fill="#ffffff" stroke="#d7e2eb"/>';
    svg+=svgText(cardX+cardW-14,320,catEn[name],17,{anchor:"end",weight:700});
    svg+=svgText(cardX+cardW-14,360,pct.toLocaleString("fa-IR",{minimumFractionDigits:1,maximumFractionDigits:1})+"٪",25,{anchor:"end",weight:700,fill:catColors[name]});
    svg+=svgText(cardX+14,360,cardToman+" تومان",14,{anchor:"start",fill:"#526579"});
    cardX+=295;
  }

  // Top-right dashboard: larger, more graphical donut chart.
  const sx=940,sy=425,sw=820;
  svg+='<rect x="'+sx+'" y="'+sy+'" width="'+sw+'" height="330" rx="16" fill="#ffffff" stroke="#d7e2eb"/>';
  svg+=svgText(sx+sw-25,sy+42,"ترکیب دارایی",25,{anchor:"end",weight:700});

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
  svg+=svgText(cx0,cy0-7,formatTomanAmount(total/10),17,{anchor:"middle",weight:700});
  svg+=svgText(cx0,cy0+20,"تومان",12,{anchor:"middle",fill:"#607080"});

  // Legend is deliberately shifted to the right of the donut.
  cards.forEach(([name,val],i)=>{
    const yy=sy+82+i*47;
    const lx=sx+790;
    svg+='<rect x="'+lx+'" y="'+(yy-15)+'" width="20" height="20" rx="5" fill="'+catColors[name]+'"/>';
    svg+=svgText(sx+775,yy,catEn[name],16,{anchor:"end",weight:600});
    svg+=svgText(sx+525,yy,(total?val/total*100:0).toLocaleString("fa-IR",{minimumFractionDigits:1,maximumFractionDigits:1})+"٪",16,{anchor:"end",weight:700});
  });

  // Top-left dashboard: summary.
  const tx=40,ty=425,tw=850;
  svg+='<rect x="'+tx+'" y="'+ty+'" width="'+tw+'" height="330" rx="16" fill="#ffffff" stroke="#d7e2eb"/>';
  svg+=svgText(tx+tw-25,ty+42,"خلاصه پرتفوی",25,{anchor:"end",weight:700});
  const summary=[["ارزش کل",toman(total/10)],["ارزش دلاری",usdText(valueUsd(total,usdIrr))],["تعداد دارایی‌ها",enNum(rows.length)],["نرخ دلار (تومان)",formatTomanAmount(usdIrr/10)],["زمان قیمت‌ها",priceTime]];
  summary.forEach(([k,v],i)=>{
    const yy=ty+92+i*48;
    svg+=svgText(tx+tw-25,yy,k,17,{anchor:"end",weight:600});
    svg+=svgText(tx+25,yy,v,16,{anchor:"start",weight:k==="زمان قیمت‌ها"?700:400,fill:"#526579"});
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
      if(k==="rank")v=enNum(v);
      if(k==="asset")v=assetLabel(v,noteOptions);
      if(k==="valueToman")v=formatTomanAmount(v);
      else if(k==="valueUsd")v=usdText(v);
      else if(k==="pct")v=r.pct.toLocaleString("fa-IR",{minimumFractionDigits:1,maximumFractionDigits:1})+"٪";
      else if(k==="qty")v=r.qtyDecimals===null?enNum(v):Number(v).toLocaleString("fa-IR",{minimumFractionDigits:r.qtyDecimals,maximumFractionDigits:r.qtyDecimals});
      const font=(k==="asset"||k==="group"||k==="source")?12:13;
      v=fit(v,w,font);
      svg+=svgText(xmap[k]+w-8,y+25,String(v),font,{anchor:"end",fill:"#243b53"});
    }
  });

  if(noteLines.length){
    svg+='<rect data-section="footnotes" x="40" y="'+noteY+'" width="1720" height="'+noteH+'" rx="16" fill="#edf4f8" stroke="#d7e2eb"/>';
    svg+=svgText(1730,noteY+38,"یادداشت دارایی‌ها (*)",20,{anchor:"end",weight:700});
    noteLines.forEach((line,index)=>{svg+=svgText(1730,noteY+70+index*28,line,16,{anchor:"end"});});
  }
  svg+='</svg>';
  return svg;
}
async function prepareAllocation(q,blackRockPriceRial,{guest=false,includePrivateNotes=false}={}){
  const noteOptions={includePrivateNotes:!guest&&includePrivateNotes};
  const {prices,errors}=await getPrices();
  const effectiveBlackRockPrice=prices["بلک راک"]?.priceRial??(guest?GUEST_ECOCOACH_PRICE_RIAL:blackRockPriceRial);
  const usdIrr=prices["دلار"]?.priceRial;
  if(!usdIrr)return {text:"دریافت نرخ دلار آزاد ناموفق بود؛ ارزش‌گذاری انجام نشد."};
  const missingQuantities=ASSETS.filter(a=>q[a]===undefined||!Number.isFinite(Number(q[a]))||Number(q[a])<0);
  if(missingQuantities.length)return {text:withAssetFootnotes("ارزش‌گذاری انجام نشد؛ مقدار این دارایی‌ها موجود یا معتبر نیست: "+missingQuantities.map(asset=>assetLabel(asset,noteOptions)).join("، "),missingQuantities,noteOptions)};
  const missingPrices=ASSETS.filter(a=>{
    if(a==="بلک راک")return effectiveBlackRockPrice===null||effectiveBlackRockPrice===undefined;
    return !!errors[a]||!prices[a];
  });
  if(missingPrices.length){
    const otherMissing=missingPrices.filter(a=>a!=="بلک راک");
    if(!otherMissing.length&&missingPrices.includes("بلک راک"))return {needsEcoCoachPrice:true,text:withAssetFootnotes("برای تهیه گزارش، قیمت فعلی هر واحد صندوق "+assetLabel("بلک راک")+" (EcoCoach) را به تومان ارسال کنید.\n\nتعداد: "+format(q["بلک راک"])+" واحد",["بلک راک"])};
    const lines=["گزارش ارزش‌گذاری کامل تهیه نشد. برای جلوگیری از نمایش جمع و درصدهای ناقص، هیچ جمع کل یا نموداری ارائه نمی‌شود."];
    if(otherMissing.length)lines.push("قیمت ناموجود/نامعتبر: "+otherMissing.map(a=>assetLabel(a,noteOptions)+" ("+(errors[a]||"قیمت دریافت نشد")+")").join("؛ "));
    if(missingPrices.includes("بلک راک"))lines.push("لطفاً قیمت فعلی هر واحد صندوق "+assetLabel("بلک راک")+" (EcoCoach) را به تومان ارسال کنید. تعداد: "+format(q["بلک راک"])+" واحد");
    return {text:withAssetFootnotes(lines.join("\n\n"),missingPrices,noteOptions)};
  }
  let total=0;const vals={};
  for(const a of ASSETS){
    if(a==="بلک راک")continue;
    const qty=Number(q[a]);
    vals[a]=valueRial(a,qty,prices[a],usdIrr);
    total+=vals[a];
  }
  if(effectiveBlackRockPrice!==null){const v=qSafe(q["بلک راک"])*effectiveBlackRockPrice;vals["بلک راک"]=v;total+=v;delete errors["بلک راک"];}
  const reportPrices={...prices};
  if(!prices["بلک راک"]&&effectiveBlackRockPrice!==null){
    reportPrices["بلک راک"]=guest
      ?{priceRial:GUEST_ECOCOACH_PRICE_RIAL,source:"Owner-approved guest fallback",fixedPrice:true,unit:"IRR/unit"}
      :{priceRial:blackRockPriceRial,source:"User input",retrievedAt:new Date().toISOString(),unit:"IRR/unit"};
  }
  if(!Number.isFinite(total)||total<0||Object.values(vals).some(value=>!Number.isFinite(value)||value<0))
    return {text:"ارزش‌گذاری کامل و معتبر نیست؛ هیچ جمع کل، درصد یا نموداری ارائه نمی‌شود."};
  const selected=filteredReportValues(vals);
  if(!selected.total)return {empty:true,text:"هیچ دارایی با ارزش حداقل ۵۰،۰۰۰ تومان در گزارش وجود ندارد."};
  return {...selected,prices:reportPrices,usdIrr,priceTime:new Date().toISOString()};
}
function renderAllocationSvg(svg){
  const fontPath=path.join(process.cwd(),"assets/fonts/Estedad-Regular.ttf");
  const boldFontPath=path.join(process.cwd(),"assets/fonts/Estedad-Bold.ttf");
  const rendered=new Resvg(svg,{font:{fontFiles:[fontPath,boldFontPath],loadSystemFonts:false,defaultFontFamily:"Estedad",sansSerifFamily:"Estedad"}}).render();
  return rendered.asPng();
}
function allocationTextReport(q,report,snapshot,noteOptions={}){
  const header="<b>گزارش تفصیلی آخرین ترکیب دارایی</b>\n"+
    (snapshot?"همگام‌سازی مقادیر: "+boldPortfolioTime(snapshot.updated_at)+"\n":"")+
    "قیمت‌های بازار: "+boldPortfolioTime(report.priceTime)+"\n"+
    "ارزش کل گزارش: <b>"+formatTomanAmount(report.total/10)+" تومان</b>";
  const messages=[];let chunk=header;
  const shown=visibleReportAssets(report.vals);
  shown.forEach((asset,index)=>{
    const block=detailedAssetTextBlock(q,asset,index,report.prices[asset],report.vals[asset],noteOptions);
    if((chunk+"\n\n"+block).length>3500){messages.push(chunk);chunk="<b>ادامه گزارش ترکیب دارایی</b>";}
    chunk+="\n\n"+block;
  });
  if(!shown.length)chunk+="\n\nهیچ دارایی با ارزش حداقل ۵۰،۰۰۰ تومان وجود ندارد.";
  const notes=assetFootnotes(shown,noteOptions);
  if(notes){
    if((chunk+"\n\n"+notes).length>3500){messages.push(chunk);chunk=notes;}
    else chunk+="\n\n"+notes;
  }
  messages.push(chunk);
  const percentages="<b>درصد گروه‌های دارایی</b>\n\n"+allocationGroups(report.vals,report.total).map(group=>
    "<b>"+group.label+"</b>: "+group.percentage.toLocaleString("fa-IR",{minimumFractionDigits:2,maximumFractionDigits:2})+"٪"
  ).join("\n")+"\n\nقیمت‌های بازار: "+boldPortfolioTime(report.priceTime);
  return {messages,percentages,total:report.total};
}
async function latestAllocationReport(q,blackRockPriceRial,format="image",snapshot=null,{guest=false,includePrivateNotes=false}={}){
  const noteOptions={includePrivateNotes:!guest&&includePrivateNotes};
  const report=await prepareAllocation(q,blackRockPriceRial,{guest,...noteOptions});
  if(report.text)return guest&&!report.empty?{text:"تهیه نمودار فعلاً ممکن نیست. لطفاً بعداً دوباره تلاش کنید."}:report;
  if(guest)return {png:renderAllocationSvg(buildAllocationPieSvg(report,snapshot,{guest:true})),guestSafe:true};
  if(format==="text")return allocationTextReport(q,report,snapshot,noteOptions);
  if(format==="chart")return {png:renderAllocationSvg(buildAllocationPieSvg(report,snapshot)),total:report.total,captionFootnotes:assetFootnotes(visibleReportAssets(report.vals),{html:false,...noteOptions})};
  return {png:renderAllocationSvg(buildPortfolioSvg(q,report.vals,report.total,report.prices,report.usdIrr,noteOptions)),total:report.total};
}
async function allocationImageReply(q,blackRockPriceRial,noteOptions={}){
  return latestAllocationReport(q,blackRockPriceRial,"image",null,noteOptions);
}

function buildAllocationPieSvg(report,snapshot=null,{guest=false}={}){
  if(!Number.isFinite(report.total)||report.total<=0||Object.values(report.vals).some(value=>!Number.isFinite(value)||value<0)||
    Math.abs(Object.values(report.vals).reduce((sum,value)=>sum+value,0)-report.total)>Math.max(1,report.total)*1e-10)
    throw new Error("invalid_allocation_chart");
  report={...report,...filteredReportValues(report.vals)};
  const groups=allocationGroups(report.vals,report.total);
  if(!Number.isFinite(report.total)||report.total<=0||groups.some(group=>!Number.isFinite(group.value)||group.value<0)||
    Math.abs(groups.reduce((sum,group)=>sum+group.value,0)-report.total)>Math.max(1,report.total)*1e-10)
    throw new Error("invalid_allocation_chart");
  const cx=800,cy=565,rx=440,ry=242,depth=50;
  const palette={"طلا و سکه":"#e7bd66","نقره":"#a3b3c8","سهام و صندوق":"#7896ee","رمز ارز":"#eb949f","Tether":"#61c5aa","US Dollar":"#96c6d7"};
  const theme={background:"#101b2e",card:"#19283f",ink:"#f1f5fb",muted:"#9caec5"};
  const point=(angle,offset=0)=>[cx+rx*Math.cos(angle),cy+ry*Math.sin(angle)+offset];
  const xy=point=>point.map(value=>value.toFixed(3)).join(" ");
  const shade=(color,factor)=>"#"+color.slice(1).match(/../g).map(value=>Math.min(255,Math.round(parseInt(value,16)*factor)).toString(16).padStart(2,"0")).join("");
  const percent=group=>group.percentage.toLocaleString("fa-IR",{minimumFractionDigits:2,maximumFractionDigits:2})+"٪";
  let angle=-Math.PI/2;
  const slices=groups.map((group,index)=>{
    const start=angle,end=start+group.percentage/100*Math.PI*2;angle=end;
    return {...group,index,start,end,color:palette[group.category]};
  });
  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1160" viewBox="0 0 1600 1160">'+
    '<defs><filter id="shadow" x="-30%" y="-70%" width="160%" height="250%"><feGaussianBlur stdDeviation="20"/></filter>';
  for(const slice of slices){
    svg+='<linearGradient id="top'+slice.index+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+shade(slice.color,1.10)+'"/><stop offset=".55" stop-color="'+slice.color+'"/><stop offset="1" stop-color="'+shade(slice.color,.96)+'"/></linearGradient>'+
      '<linearGradient id="side'+slice.index+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+shade(slice.color,.8)+'"/><stop offset="1" stop-color="'+shade(slice.color,.58)+'"/></linearGradient>';
  }
  svg+='</defs><rect width="1600" height="1160" fill="'+theme.background+'"/>';
  svg+='<rect x="36" y="184" width="1528" height="831" rx="42" fill="'+theme.card+'"/>';
  svg+=svgText(800,70,"نمودار ترکیب دارایی",42,{anchor:"middle",weight:700,fill:theme.ink});
  svg+=svgText(800,115,"قیمت‌های بازار: "+portfolioTime(report.priceTime),22,{anchor:"middle",weight:700,fill:theme.muted});
  if(snapshot)svg+=svgText(800,152,"همگام‌سازی مقادیر: "+portfolioTime(snapshot.updated_at),19,{anchor:"middle",weight:700,fill:theme.muted});
  svg+='<ellipse cx="800" cy="633" rx="430" ry="234" fill="#000000" opacity=".3" filter="url(#shadow)"/>';
  // Soften corners and leave narrow gaps without changing computed percentages.
  const geometry=slice=>{
    const span=slice.end-slice.start,gap=Math.min(.009,span*.06);
    return {start:slice.start+gap,end:slice.end-gap,corner:Math.min(.045,span*.12),arc:Math.min(.03,span*.16)};
  };
  // Only front-facing outer arcs have visible vertical walls, with rounded bottoms.
  for(const slice of slices){
    if(slice.value===0)continue;
    for(const turn of [-1,0,1]){
      const shape=geometry(slice);
      const start=Math.max(shape.start,turn*2*Math.PI),end=Math.min(shape.end,turn*2*Math.PI+Math.PI);
      if(end-start<1e-10)continue;
      const inset=Math.min(.025,(end-start)/4),round=8;
      const path='M '+xy(point(start))+' A '+rx+' '+ry+' 0 0 1 '+xy(point(end))+
        ' L '+xy(point(end,depth-round))+' Q '+xy(point(end,depth))+' '+xy(point(end-inset,depth))+
        ' A '+rx+' '+ry+' 0 0 0 '+xy(point(start+inset,depth))+
        ' Q '+xy(point(start,depth))+' '+xy(point(start,depth-round))+' Z';
      svg+='<path data-layer="side" d="'+path+'" fill="url(#side'+slice.index+')"/>';
    }
  }
  for(const slice of slices){
    if(slice.value===0)continue;
    let path;
    if(slice.end-slice.start>=2*Math.PI-1e-10){
      path='M -1 0 A 1 1 0 1 1 1 0 A 1 1 0 1 1 -1 0 Z';
    }else{
      const {start,end,corner,arc}=geometry(slice),tip=.062;
      const p=(radius,angle)=>[radius*Math.cos(angle),radius*Math.sin(angle)].map(value=>value.toFixed(8)).join(" ");
      path='M '+p(tip,start)+' L '+p(1-corner,start)+' Q '+p(1,start)+' '+p(1,start+arc)+
        ' A 1 1 0 '+(end-start-2*arc>Math.PI?1:0)+' 1 '+p(1,end-arc)+
        ' Q '+p(1,end)+' '+p(1-corner,end)+' L '+p(tip,end)+' Q 0 0 '+p(tip,start)+' Z';
    }
    svg+='<path data-layer="top" data-category="'+escXml(slice.category)+'" data-percentage="'+slice.percentage+'" d="'+path+'" transform="translate('+cx+' '+cy+') scale('+rx+' '+ry+')" fill="url(#top'+slice.index+')"/>';
    const shape=geometry(slice),start=shape.start+Math.min(.05,(shape.end-shape.start)/5),end=shape.end-Math.min(.05,(shape.end-shape.start)/5);
    svg+='<path d="M '+xy(point(start))+' A '+rx+' '+ry+' 0 '+(end-start>Math.PI?1:0)+' 1 '+xy(point(end))+'" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".24"/>';
  }
  // Eight nonoverlapping perimeter positions; match slices in circular order so
  // callouts remain legible even with very uneven or tiny holdings.
  const slots=[
    {x:1060,y:251,edge:[1060,302]}, {x:1420,y:419,edge:[1280,419]},
    {x:1420,y:687,edge:[1280,687]}, {x:1060,y:922,edge:[1060,871]},
    {x:540,y:922,edge:[540,871]}, {x:180,y:687,edge:[320,687]},
    {x:180,y:419,edge:[320,419]}, {x:540,y:251,edge:[540,302]}
  ].map(slot=>{
    let angle=Math.atan2((slot.y-cy)/(ry+50),(slot.x-cx)/(rx+42));
    if(angle<-Math.PI/2)angle+=2*Math.PI;
    return {...slot,angle};
  });
  const positive=slices.filter(slice=>slice.value>0),assigned=new Map();
  const distance=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  let bestCost=Infinity,best=[];
  const choose=(chosen,next)=>{
    if(chosen.length===positive.length){
      for(let rotation=0;rotation<chosen.length;rotation++){
        const order=chosen.map((_,index)=>chosen[(index+rotation)%chosen.length]);
        const cost=positive.reduce((sum,slice,index)=>sum+distance((slice.start+slice.end)/2,slots[order[index]].angle)**2,0);
        if(cost<bestCost){bestCost=cost;best=order;}
      }
      return;
    }
    for(let index=next;index<=slots.length-(positive.length-chosen.length);index++)choose([...chosen,index],index+1);
  };
  choose([],0);
  positive.forEach((slice,index)=>assigned.set(slice.index,best[index]));
  const unused=slots.map((_,index)=>index).filter(index=>!best.includes(index));
  slices.filter(slice=>slice.value===0).forEach(slice=>assigned.set(slice.index,unused.shift()));
  for(const slice of slices){
    const slot=slots[assigned.get(slice.index)],width=280,height=102;
    if(slice.value>0){
      const middle=(slice.start+slice.end)/2,start=point(middle);
      const outer=angle=>[cx+(rx+42)*Math.cos(angle),cy+(ry+50)*Math.sin(angle)];
      const delta=distance(slot.angle,middle),bend=outer(middle);
      // Larger displacements follow the exterior ellipse, never cut across slices.
      const path='M '+xy(start)+' L '+xy(bend)+
        (Math.abs(delta)>.45?' A '+(rx+42)+' '+(ry+50)+' 0 0 '+(delta>0?1:0)+' '+xy(outer(slot.angle)):'')+
        ' L '+xy(slot.edge);
      svg+='<path data-layer="leader" data-leader-category="'+escXml(slice.category)+'" data-anchor="'+xy(start)+'" d="'+path+'" fill="none" stroke="'+slice.color+'" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
      svg+='<circle cx="'+start[0]+'" cy="'+start[1]+'" r="4.4" fill="'+slice.color+'"/>';
    }
    svg+='<rect data-label-category="'+escXml(slice.category)+'" x="'+(slot.x-width/2)+'" y="'+(slot.y-height/2)+'" width="'+width+'" height="'+height+'" rx="23" fill="'+theme.background+'"/>';
    svg+='<rect x="'+(slot.x+width/2-27)+'" y="'+(slot.y-height/2+23)+'" width="10" height="10" rx="4" fill="'+slice.color+'"/>';
    svg+=svgText(slot.x,slot.y-13,slice.label,24,{anchor:"middle",weight:700,fill:theme.ink});
    svg+=svgText(slot.x,slot.y+30,percent(slice),31,{anchor:"middle",weight:700,fill:slice.color});
  }
  if(!guest){
    svg+='<rect x="36" y="1038" width="1528" height="91" rx="28" fill="'+theme.card+'"/>';
    svg+=svgText(1510,1075,"ارزش کل گزارش",21,{anchor:"end",weight:700,fill:theme.muted});
    svg+=svgText(1510,1110,moneyFa(report.total/10),29,{anchor:"end",weight:700,fill:theme.ink});
  }
  return svg+'</svg>';
}

function formatPrice(asset,p){
  return p.priceUsd!==undefined?"$"+format(p.priceUsd):formatToman(p.priceRial);
}
function formatToman(rial){return formatTomanAmount(rial/10,{persian:false})+" toman";}
function format(v){return Number(v).toLocaleString("en-US",{maximumFractionDigits:8});}
function group(q,names,noteOptions={}){return withAssetFootnotes(names.map(n=>assetLabel(n,noteOptions)+": "+(q[n]===undefined?"not synchronized":format(q[n]))).join("\n"),names,noteOptions);}
function guestHelp(){return "دسترسی شما مهمان است. فقط نمودار درصد ترکیب دارایی در دسترس است؛ از دکمه زیر استفاده کنید.";}
function help({reportsOnly=false}={}){return withAssetFootnotes((reportsOnly?"دسترسی مشاور مالی • گزارش‌های دارایی\n":"Portfolio Agent is online.\n")+"برای انتخاب گزارش، از دکمه‌های منو استفاده کنید.\n\n"+(reportsOnly?"":"/status — portfolio status\n")+"/assets — asset list\n/latest_allocation — آخرین ترکیب دارایی: انتخاب گزارش تصویری یا متنی با مقادیر و قیمت‌های تازه\n/gold_and_other_precious_metals — gold and other precious metals\n/crypto — live crypto valuation\n/gold_history — ارزش هفتگی بر حسب گرم طلای ۱۸ عیار\n/allocation_chart — نمودار سه‌بعدی ترکیب دارایی با مقادیر و قیمت‌های تازه\n/cash_dollar — Cash Dollar (دلار نقدی)\n\nبرای تهیه گزارش ارزش‌گذاری، ربات قیمت فعلی هر واحد "+assetLabel("بلک راک")+" (EcoCoach) را به تومان از شما می‌پرسد.",["بلک راک"]);}
async function safeSnapshot(){try{return await loadSnapshot();}catch(e){return null;}}
function quantitySnapshotStatus(snapshot){
  const stamp=snapshot?.updated_at;
  const ms=stamp?Date.parse(stamp):NaN;
  const age=Date.now()-ms;
  const maxAgeMs=24*60*60*1000;
  if(!snapshot||!Number.isFinite(ms)||age<0||age>maxAgeMs){
    const when=boldPortfolioTime(stamp);
    return {stale:true,message:"Snapshot مقادیر پرتفوی قدیمی یا نامعتبر است (آخرین زمان ثبت‌شده: "+when+"). برای جلوگیری از ارزش‌گذاری با مقادیر قدیمی، گزارش ارزش‌گذاری متوقف شد. ابتدا همگام‌سازی Trading Journal را اجرا و سپس /status را بررسی کنید."};
  }
  return {stale:false,message:""};
}

const BUTTON_MENU=[
  [{text:"آخرین ترکیب دارایی",command:"/latest_allocation"}],
  [{text:"وضعیت",command:"/status"},{text:"دارایی‌ها",command:"/assets"}],
  [{text:"طلا و سایر فلزات گرانبها",command:"/gold_and_other_precious_metals"},{text:"رمزارز",command:"/crypto"}],
  [{text:"دلار نقدی",command:"/cash_dollar"},{text:"نمودار ترکیب دارایی",command:"/allocation_chart"}],
  [{text:"روند ارزش بر حسب طلا",command:"/gold_history"}],
  [{text:"راهنما",command:"/help"}]
];
const MENU_COMMANDS=new Map([...BUTTON_MENU.flat().map(button=>[button.text,button.command]),
  ["پنل مدیریت","/admin"],
  ["Latest Allocation","/latest_allocation"],
  ["آخرین تخصیص دارایی","/latest_allocation"],
  ["Cash Dollar","/cash_dollar"],["/cash","/cash_dollar"],["نقدینگی","/cash_dollar"],
  ["تخصیص دارایی","/latest_allocation"],["به‌روزرسانی","/latest_allocation"],
  ["/allocation","/latest_allocation"],["/refresh","/latest_allocation"]]);
async function portfolioKeyboard(chatId){
  const state=await loadAccessState();
  if(!hasBotAccess(String(chatId),state))return null;
  const admin=isBotAdmin(String(chatId),state);
  const reports=canReadReports(String(chatId),state);
  const keyboard=reports?BUTTON_MENU.map(row=>row.filter(button=>admin||button.command!=="/status").map(button=>({text:button.text}))).filter(row=>row.length):[[{text:"نمودار ترکیب دارایی"}]];
  if(admin)keyboard.at(-1).push({text:"پنل مدیریت"});
  return {keyboard,
    resize_keyboard:true,is_persistent:false,one_time_keyboard:false,
    input_field_placeholder:reports?"یک گزینه انتخاب کنید یا قیمت "+assetLabel("بلک راک")+" را وارد کنید":"نمایش نمودار درصد ترکیب دارایی"};
}

const TEMPORARY_REPLY_PREFIX="portfolio/temporary-replies/";
async function deleteTemporaryReply(chatId,messageId){
  try{
    const r=await fetch("https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/deleteMessage",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:chatId,message_id:messageId})});
    const result=await r.json();
    return !!result.ok||r.status===400;
  }catch(_){return false;}
}
// Store only bot-generated message IDs. Never delete user input or report history.
async function cleanupTemporaryReplies(chatId,messageId,temporary){
  if(!Number.isSafeInteger(messageId)||messageId<=0)return;
  const key=TEMPORARY_REPLY_PREFIX+chatId+".json";
  try{
    const state=await readPrivateJson(key)||{lastDeliveredId:0,messages:[]};
    // An older HTTP response arriving late must not replace a newer prompt.
    if(messageId<=state.lastDeliveredId){
      if(temporary&&messageId<state.lastDeliveredId)await deleteTemporaryReply(chatId,messageId);
      return;
    }
    const remaining=[];
    for(const old of state.messages||[]){
      if(!Number.isSafeInteger(old.message_id)||old.message_id>=messageId){remaining.push(old);continue;}
      if(Date.now()-Date.parse(old.created_at)>=48*60*60*1000)continue;
      // Retry transient deletion failures without disrupting the new report.
      if(!await deleteTemporaryReply(chatId,old.message_id))remaining.push(old);
    }
    if(temporary)remaining.push({message_id:messageId,created_at:new Date().toISOString()});
    await writePrivateJson(key,{lastDeliveredId:messageId,messages:remaining.slice(-10)});
  }catch(_){console.warn("Temporary reply cleanup unavailable");}
}
async function replaceMainMenuAnchor(chatId,messageId){
  if(!Number.isSafeInteger(messageId)||messageId<=0)return;
  const key="portfolio/main-menu/"+chatId+".json";
  try{
    const previous=await readPrivateJson(key);
    if(previous?.message_id>=messageId){
      if(previous.message_id>messageId)await deleteTemporaryReply(chatId,messageId);
      return;
    }
    await writePrivateJson(key,{message_id:messageId,created_at:new Date().toISOString()});
    if(Number.isSafeInteger(previous?.message_id)&&previous.message_id>0&&
      Date.now()-Date.parse(previous.created_at)<48*60*60*1000)await deleteTemporaryReply(chatId,previous.message_id);
  }catch(_){console.warn("Main menu message tracking unavailable");}
}
async function deliverTelegram(chatId,method,options,{temporary=false,menuAnchor=false,trackReplies=true}={}){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token)return false;
  try{
    const r=await fetch("https://api.telegram.org/bot"+token+"/"+method,options);
    const result=await r.json();
    if(!r.ok||!result.ok){console.warn("Telegram delivery failed",method,r.status);return false;}
    if(trackReplies){
      await cleanupTemporaryReplies(chatId,result.result?.message_id,temporary);
      if(menuAnchor)await replaceMainMenuAnchor(chatId,result.result?.message_id);
    }
    return true;
  }catch(_){console.warn("Telegram delivery unavailable",method);return false;}
}

async function sendTelegram(chatId,text,{menu=false,temporary=false,removeMenu=false,menuAnchor=false,audience="report"}={}){
  if(!String(text||"").trim())return false;
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token){console.error("TELEGRAM_BOT_TOKEN is not configured");return;}

  const send=async msg=>{
    const markup=menu?await portfolioKeyboard(chatId):removeMenu?{remove_keyboard:true}:null;
    if(menu&&!markup)return false;
    if(menu){
      try{
        const access=await loadAccessState({strict:true});
        if(!hasBotAccess(String(chatId),access)||audience!=="guest"&&!(audience==="admin"?isBotAdmin(String(chatId),access):canReadReports(String(chatId),access)))return false;
      }catch(_){return false;}
    }
    return deliverTelegram(chatId,"sendMessage",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:chatId,text:msg,parse_mode:"HTML",...(markup?{reply_markup:markup}:{})})
    },{temporary,menuAnchor});
  };

  // Telegram limits text messages to 4096 characters. Split the audit table
  // into balanced HTML <pre> blocks so large portfolio reports are delivered
  // instead of silently failing.
  if(String(text).length<=3900)return send(text);

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

async function sendTelegramPhoto(chatId,png,caption,{guestSafe=false,audience="report"}={}){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token){console.error("TELEGRAM_BOT_TOKEN is not configured");return;}
  const form=new FormData();
  const keyboard=await portfolioKeyboard(chatId);
  if(!keyboard)return false;
  try{
    const access=await loadAccessState({strict:true});
    if(!hasBotAccess(String(chatId),access)||audience==="admin"&&!isBotAdmin(String(chatId),access)||!guestSafe&&audience!=="admin"&&!canReadReports(String(chatId),access))return false;
  }catch(_){return false;}
  form.append("chat_id",String(chatId));
  form.append("photo",new Blob([png],{type:"image/png"}),"portfolio-report.png");
  form.append("reply_markup",JSON.stringify(keyboard));
  if(caption)form.append("caption",caption);
  return deliverTelegram(chatId,"sendPhoto",{method:"POST",body:form});
}


const GOLD_HISTORY_KEY='portfolio/gold-history/latest.json';
const historyOptions=()=>({assets:ASSETS,groups:Object.fromEntries(ASSETS.map(a=>[a,categoryName(a)])),now:Date.now()});
async function historyState(){
  const blob=await get(GOLD_HISTORY_KEY,ACCESS_READ_OPTIONS);
  if(!blob)return {data:{version:1,revision:null,weeks:[]},etag:null};
  const data=await streamJson(blob.stream);
  if(data.version!==1||!Array.isArray(data.weeks)||!blob.blob?.etag||blob.blob.etag.startsWith('W/'))throw new Error('history_unavailable');
  return {data,etag:blob.blob.etag};
}
async function saveHistory(current,weeks){
  const data={version:1,manual_baseline:current.data.manual_baseline||{...MANUAL},revision:crypto.randomUUID(),updated_at:new Date().toISOString(),weeks};
  await put(GOLD_HISTORY_KEY,JSON.stringify(data),{access:'private',addRandomSuffix:false,contentType:'application/json',
    ...(current.etag?{ifMatch:current.etag}:{allowOverwrite:false})});
  return data;
}
async function historyRead(req,res){
  if(!syncAuth(req))return res.status(401).json({ok:false});
  try{
    if(req.query.data==='gold-history-file'){
      const current=await historyState(),file=await readPrivateJson('portfolio/gold-history/workbook.json');
      if(!file||file.revision!==current.data.revision)return res.status(409).json({ok:false,error:'workbook_not_current'});
      const blob=await get(file.key,{access:'private',useCache:false});if(!blob)return res.status(404).json({ok:false});
      const reader=blob.stream.getReader(),chunks=[];while(true){const part=await reader.read();if(part.done)break;chunks.push(Buffer.from(part.value));}
      const bytes=Buffer.concat(chunks);
      return res.status(200).json({ok:true,revision:file.revision,content_base64:bytes.toString('base64'),sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')});
    }
    if(req.query.data==='gold-history-config')return res.status(200).json({ok:true,assets:ASSETS,manual:(await historyState()).data.manual_baseline||MANUAL,
      groups:historyOptions().groups,minimum_rial:MIN_REPORT_VALUE_RIAL,manual_unchanged_since:'2025-10-25',manual_unchanged_until:'2026-10-25',
      manual_confirmation:'Owner confirmed unchanged over the preceding year on 2026-10-25'});
    return res.status(200).json({ok:true,...(await historyState()).data});
  }catch(_){return res.status(503).json({ok:false});}
}
function currentHistoryWeek(){
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const day=new Date(local+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+2)%7);
  return day.toISOString().slice(0,10);
}
async function historyWrite(req,res){
  if(!syncAuth(req))return res.status(401).json({ok:false});
  try{
    const current=await historyState(),body=req.body||{};
    if(req.query.sync==='gold-history-file'){
      if(body.revision!==current.data.revision)return res.status(409).json({ok:false,error:'history_changed'});
      if(typeof body.content_base64!=='string'||body.content_base64.length>3000000)return res.status(400).json({ok:false});
      const bytes=Buffer.from(body.content_base64,'base64');
      if(bytes.length<100||bytes.subarray(0,2).toString()!=='PK'||bytes.includes(Buffer.from('vbaProject.bin')))return res.status(400).json({ok:false});
      const key='portfolio/gold-history/workbooks/'+body.revision+'.xlsx';
      await put(key,bytes,{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const latest=await historyState();if(latest.data.revision!==body.revision)return res.status(409).json({ok:false,error:'history_changed'});
      await writePrivateJson('portfolio/gold-history/workbook.json',{revision:body.revision,key,updated_at:new Date().toISOString()});
      return res.status(200).json({ok:true,revision:body.revision,stored:true});
    }
    let incoming;
    if(req.query.sync==='gold-observation'){
      const journal=ASSETS.filter(a=>!(a in MANUAL));
      if(!body.assets||Object.keys(body.assets).length!==23||journal.some(a=>typeof body.assets[a]!=='number'||!Number.isFinite(body.assets[a])||body.assets[a]<0)||
        !Number.isFinite(Date.parse(body.source_checked_at))||Date.now()-Date.parse(body.source_checked_at)>120000||Date.parse(body.source_checked_at)>Date.now())return res.status(400).json({ok:false});
      let week=currentHistoryWeek();const localDay=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',weekday:'short'}).format(new Date());
      if(body.bootstrap===true){const day=new Date(week+'T12:00:00Z');if(localDay!=='Fri')day.setUTCDate(day.getUTCDate()+7);week=day.toISOString().slice(0,10);}
      if(body.bootstrap!==true&&!['Fri','Sat'].includes(localDay))return res.status(409).json({ok:false,error:'outside_weekly_capture_window'});
      const {prices}=await getPrices(),asof=new Date().toISOString(),fx=prices['دلار']?.priceRial,quotes={};
      for(const asset of ASSETS){
        const p=prices[asset];if(!p)continue;
        const price=cryptoAsset(asset)?p.priceUsd*fx:p.priceRial;
        if(Number.isFinite(price)&&price>0)quotes[asset]={price_rial:price,source:cryptoAsset(asset)?p.source+' × '+prices['دلار']?.source:p.source,quoted_at:p.quotedAt||p.retrievedAt||asof};
      }
      const gold=prices['آبشده (طلب)'];
      incoming=[{week_ending:week,mode:body.bootstrap===true?'baseline':'live',as_of:asof,source_checked_at:body.source_checked_at,workbook_updated_at:body.workbook_updated_at,
        workbook_sha256:body.workbook_sha256,quantities:{...body.assets,...MANUAL},quotes,
        gold_quote:gold?{price_rial:gold.priceRial,source:gold.source,quoted_at:gold.quotedAt||gold.retrievedAt||asof}:null,issues:[]}];
    }else{
      if(body.revision!==current.data.revision)return res.status(409).json({ok:false,error:'history_changed'});
      if(!Array.isArray(body.weeks)||!body.weeks.length||body.weeks.length>60)return res.status(400).json({ok:false});
      const manual=current.data.manual_baseline||MANUAL;
      if(body.weeks.some(w=>w.mode!=='historical'||Object.entries(manual).some(([a,q])=>w.quantities?.[a]!==q)))return res.status(400).json({ok:false});
      incoming=body.weeks;
    }
    const weeks=mergeGoldWeeks(current.data.weeks,incoming,historyOptions());
    if(weeks.length>1000)return res.status(400).json({ok:false});
    const data=await saveHistory(current,weeks);
    const pending=weeks.find(w=>w.week_ending===incoming.at(-1).week_ending&&w.mode!=='historical'&&w.quantities['بلک راک']>0&&!w.quotes['بلک راک']);
    if(body.notify===true&&pending)waitUntil(notifyHistoryPrice(pending));
    return res.status(200).json({ok:true,revision:data.revision,weeks:weeks.length,complete_weeks:weeks.filter(w=>w.status==='complete').length});
  }catch(error){return res.status(error instanceof BlobPreconditionFailedError?409:error.message==='invalid_gold_history_record'?400:503).json({ok:false,error:'history_write_failed'});}
}
async function notifyHistoryPrice(week){
  const access=await loadAccessState({strict:true});
  for(const uid of [...new Set([...adminUserIds(),...access.delegatedAdmins])])await historyPricePrompt(uid,week.week_ending);
}
async function historyPricePrompt(uid,weekEnding){
  if(!isBotAdmin(uid,await loadAccessState({strict:true})))return false;
  const week=(await historyState()).data.weeks.find(w=>w.week_ending===weekEnding);
  if(!week||!(week.quantities['بلک راک']>0)||week.quotes['بلک راک'])return false;
  const response=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/sendMessage',{
    method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:Number(uid),parse_mode:'HTML',
      text:'برای ثبت ارزش هفتگی پرتفوی، قیمت هر واحد صندوق بلک راک (اکوکوچ) در زمان زیر را به تومان پاسخ دهید.\n\nزمان ثبت: '+boldPortfolioTime(week.as_of),
      reply_markup:{force_reply:true,input_field_placeholder:'قیمت هر واحد به تومان'}})});
  const result=await response.json();
  if(response.ok&&result.ok&&result.result?.message_id){
    await writePrivateJson('portfolio/gold-history/prompts/'+uid+'/'+result.result.message_id+'.json',{week_ending:weekEnding});
    await cleanupTemporaryReplies(Number(uid),result.result.message_id,true);return true;
  }
  return false;
}
async function acceptHistoryPrice(chatId,uid,weekEnding,text){
  if(!isBotAdmin(uid,await loadAccessState({strict:true})))return;
  const price=parseUserPrice(text);
  if(!Number.isFinite(price)||price<=0||price>Number.MAX_SAFE_INTEGER){await sendTelegram(chatId,'قیمت معتبر هر واحد را به تومان پاسخ دهید.',{menu:true,audience:'admin'});return;}
  const current=await historyState(),week=current.data.weeks.find(w=>w.week_ending===weekEnding);
  if(!week||week.quotes['بلک راک']){await sendTelegram(chatId,'قیمت این هفته قبلاً ثبت شده است.',{menu:true,audience:'admin'});return;}
  const input={...week,quotes:{...week.quotes,'بلک راک':{price_rial:price,source:'Admin confirmed for recorded week',quoted_at:week.as_of}}};
  const replacement=calculateGoldWeek(input,historyOptions());
  const weeks=mergeGoldWeeks(current.data.weeks.filter(w=>w.week_ending!==weekEnding),[replacement],historyOptions());
  await saveHistory(current,weeks);
  const queued=await dispatchHistoryExport();
  await sendTelegram(chatId,replacement.status==='complete'?'قیمت ثبت شد؛ ارزش هفتگی محاسبه شد.'+(queued?' فایل Excel در حال به‌روزرسانی است.':''):
    'قیمت بلک راک ثبت شد؛ این هفته هنوز داده‌های تأییدنشدهٔ دیگری دارد.',{menu:true,audience:'admin'});
}
async function dispatchHistoryExport(){
  try{
    const r=await fetch('https://api.github.com/repos/SahandFAME/portfolio-agent-telegram/actions/workflows/gold-history.yml/dispatches',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+process.env.GITHUB_ACTIONS_TOKEN,
        Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({ref:'main',inputs:{action:'export'}})});
    return r.status===204;
  }catch(_){return false;}
}
async function sendGoldHistory(chatId){
  if(!canReadReports(String(chatId),await loadAccessState({strict:true})))return;
  const data=(await historyState()).data;
  if(!data.weeks.length){await sendTelegram(chatId,'تاریخچهٔ هفتگی هنوز ثبت نشده است.',{menu:true});return;}
  const svg=goldHistorySvg(data.weeks,{formatTime:portfolioTime,escape:escXml,number:n=>Number(n).toLocaleString('fa-IR',{maximumFractionDigits:3})});
  await sendTelegramPhoto(chatId,renderAllocationSvg(svg),'ارزش هفتگی پرتفوی بر حسب گرم طلای ۱۸ عیار');
  if(isBotAdmin(String(chatId),await loadAccessState({strict:true}))){
    const buttons=[[{text:'دریافت فایل Excel',callback_data:'history:excel'}]];
    const pending=data.weeks.filter(w=>w.mode!=='historical'&&w.quantities['بلک راک']>0&&!w.quotes['بلک راک']).at(-1);
    if(pending)buttons.unshift([{text:'ثبت قیمت بلک راک هفته',callback_data:'history:price:'+pending.week_ending}]);
    await sendTelegramWithKeyboard(chatId,'تاریخچهٔ هفتگی',buttons,{temporary:false});
  }
}
async function handleHistoryCallback(callback){
  const uid=String(callback.from?.id||''),chat=callback.message?.chat;
  if(chat?.type!=='private'||String(chat.id)!==uid)return;
  try{
    const access=await loadAccessState({strict:true,purgeExpired:true});
    if(isExpiredMember(uid,access)){await answerCallback(callback.id,'');return;}
    if(!isBotAdmin(uid,access)){await answerCallback(callback.id,'دسترسی مدیریت ندارید.');return;}
    if(callback.data==='history:excel'){
      const current=await historyState(),file=await readPrivateJson('portfolio/gold-history/workbook.json');
      if(!file||file.revision!==current.data.revision){await dispatchHistoryExport();await answerCallback(callback.id,'فایل Excel در حال آماده‌سازی است؛ کمی بعد دوباره انتخاب کنید.');return;}
      const blob=await get(file.key,{access:'private',useCache:false});if(!blob)throw new Error();
      const reader=blob.stream.getReader(),chunks=[];while(true){const part=await reader.read();if(part.done)break;chunks.push(Buffer.from(part.value));}
      if((await historyState()).data.revision!==file.revision){await answerCallback(callback.id,'تاریخچه تغییر کرده است؛ فایل در حال به‌روزرسانی است.');return;}
      if(!isBotAdmin(uid,await loadAccessState({strict:true})))return;
      const form=new FormData();form.append('chat_id',uid);form.append('document',new Blob([Buffer.concat(chunks)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'Portfolio-18K-Gold-History.xlsx');
      await answerCallback(callback.id,'');await deliverTelegram(chat.id,'sendDocument',{method:'POST',body:form});return;
    }
    const match=String(callback.data).match(/^history:price:(\d{4}-\d{2}-\d{2})$/);
    if(match){await answerCallback(callback.id,'');await historyPricePrompt(uid,match[1]);return;}
    await answerCallback(callback.id,'گزینه نامعتبر.');
  }catch(_){await answerCallback(callback.id,'دریافت تاریخچه ناموفق بود؛ دوباره تلاش کنید.');}
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
