import { put, get, BlobPreconditionFailedError } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import path from "path";

const ONEDRIVE_CLIENT_ID = '04a73ec3-340a-4cb6-a087-7fdc4dfd93e0';
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
// Historical comments from CODEX_HANDOFF.md; never use these figures as quotes.
const ASSET_COMMENTS={
  "بلک راک":"صندوق خصوصی اکوکوچ است؛ قیمت واحد ابتدا در سایت صندوق بررسی می‌شود؛ در صورت نبود قیمت معتبر، مدیر آن را وارد می‌کند.",
  "آبشده (طلب)":"طلب از مامان به ازای ما به تفاوت خرید شمش زربد (9200 تومان در گرم طلا 6718)",
  "آبشده (شمش زربد)":"شمش زربد (در گرم 6718)؛ 1404/01/26",
  "دلار":"خریدهای تاریخی: 700 دلار در 83000 (04/02/20)؛ 2300 دلار در 108800 (04/08/04)"
};
function assetLabel(asset){return asset+(Object.hasOwn(ASSET_COMMENTS,asset)?"*":"");}
function assetCommentEntries(names){
  return [...new Set(names)].filter(asset=>Object.hasOwn(ASSET_COMMENTS,asset))
    .map(asset=>({asset,label:assetLabel(asset),comment:ASSET_COMMENTS[asset]}));
}
function assetFootnotes(names,{html=true}={}){
  const entries=assetCommentEntries(names);
  if(!entries.length)return "";
  return (html?"<b>یادداشت دارایی‌ها (*)</b>":"یادداشت دارایی‌ها (*)")+"\n"+
    entries.map(({label,comment})=>html?"<b>"+escXml(label)+"</b>: "+escXml(comment):label+": "+comment).join("\n")+
    (entries.some(({asset})=>asset!=="بلک راک")?"\nاعداد یادداشت‌های خرید تاریخی هستند و در ارزش‌گذاری روز استفاده نمی‌شوند.":"");
}
function withAssetFootnotes(text,names){const notes=assetFootnotes(names);return text+(notes?"\n\n"+notes:"");}
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
    return res.status(200).json({ok:true,service:"Portfolio Agent Telegram Bot"});
  }
  if(req.method==="POST" && req.query?.sync==="portfolio") return sync(req,res);
  if(req.method==="POST" && req.query?.complete==="latest-allocation") return completeLatestAllocation(req,res);
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
      approved_count:state.approved.length,pending_count:Object.keys(state.pending).length,
      delegated_admin_count:state.delegatedAdmins.length,audit_count:state.audit.length,
      guest_count:state.approved.filter(id=>!isBotAdmin(id,state)).length,guest_chart_only:true,
      conditional_updates_ready:!state._exists||!!state._etag});
  }catch(_){return res.status(503).json({ok:false,error:"Access storage unavailable"});}
}
async function verifyAccessStorage(){
  // Exercise conditional writes on a separate private canary, never on user
  // permissions or portfolio data. The same small path is reused each time.
  const key="portfolio/diagnostics/access-storage.json",id=crypto.randomUUID();
  try{
    await writePrivateJson(key,{check_id:id,stage:1});
    const initial=await get(key,{access:"private",useCache:false});
    const etag=initial?.blob?.etag;
    await initial?.stream?.cancel();
    if(!etag)throw new Error("missing_etag");
    const options={access:"private",addRandomSuffix:false,contentType:"application/json",ifMatch:etag};
    await put(key,JSON.stringify({check_id:id,stage:2}),options);
    const readback=await readPrivateJson(key);
    if(readback?.check_id!==id||readback.stage!==2)throw new Error("canary_readback_failed");
    try{
      await put(key,JSON.stringify({check_id:id,stage:3}),options);
      return {ok:false,conditional_writes_verified:false};
    }catch(error){
      if(!(error instanceof BlobPreconditionFailedError))throw new Error("unexpected_canary_error");
    }
    return {ok:true,conditional_writes_verified:true};
  }catch(_){return {ok:false,conditional_writes_verified:false};}
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
  if(callback){waitUntil(String(callback.data||"").startsWith("allocation:")?handleAllocationCallback(callback):handleAccessCallback(callback));return res.status(200).json({ok:true});}
  const message=req.body?.message;
  if(!message?.chat?.id)return res.status(200).json({ok:true});
  const userId=message.from?.id;
  if(message.chat.type!=="private"||userId===undefined||String(message.chat.id)!==String(userId))return res.status(200).json({ok:true});
  const text=(message.text||"").trim();
  const command=MENU_COMMANDS.get(text)||text;
  const uid=String(userId);
  const adminIds=adminUserIds();
  const state=await loadAccessState();
  const approved=new Set([...(state.approved||[]).map(String),...adminIds]);
  const isAdmin=isBotAdmin(uid,state);
  if(/^\/admin(?:@\w+)?$/.test(command)||(isAdmin&&(/^\/users(?:@\w+)?$/.test(command)||/^\/revoke(?:@\w+)?\s+\d+$/.test(command)||/^\/approve(?:@\w+)?\s+\d+$/.test(command)))){
    waitUntil(handleAdminAccessCommand(message.chat.id,command,uid));
    return res.status(200).json({ok:true});
  }
  if(!approved.has(uid)){
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

  if(!isAdmin){
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

  waitUntil((async()=>{
    try{
      const pending=await loadPendingBlackRock(message.chat.id);
      if(pending?.type==="guest_blackrock_price"&&!command.startsWith("/")){
        const price=parseUserPrice(command);
        if(price===null){await sendTelegram(message.chat.id,"لطفاً قیمت فعلی هر واحد را به تومان وارد کنید.",{menu:true,temporary:true});return;}
        const record=await readPrivateJson(ALLOCATION_REQUEST_PREFIX+pending.guest_request_id+".json");
        const current=record?await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+record.chat_id+".json"):null;
        const age=Date.now()-Date.parse(record?.requested_at);
        if(!record||record.status!=="awaiting_price"||current?.request_id!==record.request_id||
          !Number.isFinite(age)||age<0||age>ALLOCATION_DEADLINE_MS){
          await savePendingBlackRock(message.chat.id,{type:"none"});
          await sendTelegram(message.chat.id,"این درخواست نمودار منقضی یا جایگزین شده است.",{menu:true});return;
        }
        const reply=await requestLatestAllocation(record.chat_id,record.user_id,price,"chart",{approvedBy:uid});
        await savePendingBlackRock(message.chat.id,{type:"none"});
        await sendTelegram(message.chat.id,reply,{menu:true,temporary:true});return;
      }
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
        reply=quantityStatus.message;
      }else if(pending?.type==="blackrock_price"&&!command.startsWith("/")){
        const priceRial=parseUserPrice(command);
        if(priceRial===null){
          reply=withAssetFootnotes("لطفاً قیمت فعلی هر واحد "+assetLabel("بلک راک")+" (EcoCoach) را به تومان وارد کنید.",["بلک راک"]);
        }else{
          const report=await allocationImageReply(quantities,priceRial);
          if(report.text)reply=report.text;
          else await sendTelegramPhoto(message.chat.id,report.png,"گزارش ارزش‌گذاری پرتفوی • قیمت‌های زنده");
          await savePendingBlackRock(message.chat.id,{type:"none",updatedAt:new Date().toISOString()});
        }
      }else if(command==="/start"||command==="/help"||command==="/menu")reply=help();
      else if(command==="/status"){
        const status=quantitySnapshotStatus(snapshot);
        reply=snapshot?("پورتفولیو متصل است.\n\nآخرین Snapshot معاملات: "+boldPortfolioTime(snapshot.updated_at)+(snapshot.workbook_updated_at?"\nآخرین به‌روزرسانی فایل: "+boldPortfolioTime(snapshot.workbook_updated_at):"")+(status.stale?"\n\n⚠️ "+status.message:"\n\nوضعیت Snapshot: به‌روز")):"پورتفولیو متصل است، اما Snapshot معاملات هنوز همگام‌سازی نشده است.";
      }
      else if(command==="/assets")reply=assetsReply(quantities,snapshot);
      else if(command==="/gold_and_other_precious_metals"||command==="/gold")reply=await valuationReply(quantities,["طلا","عیار","گوهر","آلتون","امرالد","زرفام","سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","شمش نقره 999"],"طلا و فلزات گرانبها");
      else if(command==="/crypto")reply=await valuationReply(quantities,["BTC","ETH","Tether","Link","ADA","SOL","ONDO"],"رمزارز");
      else if(command==="/cash_dollar")reply=await valuationReply(quantities,["دلار"],"دلار نقدی");
      else reply=help();
      if(reply)await sendTelegram(message.chat.id,reply,{menu:true,temporary:reply.includes("قیمت فعلی هر واحد بلک راک")});
    }catch(e){console.error("Telegram handler error:",e);try{await sendTelegram(message.chat.id,"خطا در تهیه گزارش. لطفاً دوباره تلاش کنید.",{menu:true});}catch(_){}}
  })());
  return res.status(200).json({ok:true});
}
const ALLOCATION_REQUEST_PREFIX="portfolio/latest-allocation/requests/";
const ALLOCATION_ACTIVE_PREFIX="portfolio/latest-allocation/active/";
const ALLOCATION_SELECTION_PREFIX="portfolio/latest-allocation/selections/";
const ALLOCATION_DEADLINE_MS=10*60*1000;
async function showAllocationMenu(chatId){
  if(!isBotAdmin(String(chatId),await loadAccessState({strict:true})))return;
  const selection={selection_id:crypto.randomUUID(),created_at:new Date().toISOString(),used:false};
  await writePrivateJson(ALLOCATION_SELECTION_PREFIX+chatId+".json",selection);
  await savePendingBlackRock(chatId,{type:"allocation_format_selection",selection_id:selection.selection_id});
  await sendMainMenu(chatId);
  if(!isBotAdmin(String(chatId),await loadAccessState({strict:true})))return;
  const data=format=>"allocation:pick:"+selection.selection_id+":"+format;
  await deliverTelegram(chatId,"sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    chat_id:chatId,text:"آخرین ترکیب دارایی\n\nنوع گزارش را انتخاب کنید. پس از انتخاب، مقادیر تازه از OneDrive و قیمت‌های تازه بازار دریافت می‌شوند.",
    reply_markup:{inline_keyboard:[[{text:"گزارش تصویری",callback_data:data("image")},{text:"گزارش متنی",callback_data:data("text")}],
      [{text:"بازگشت به منوی اصلی",callback_data:data("menu")}]]}
  })},{temporary:true});
}
async function handleAllocationCallback(callback){
  const uid=String(callback.from?.id||""),chat=callback.message?.chat;
  if(chat?.type!=="private"||String(chat.id)!==uid){await answerCallback(callback.id,"دسترسی غیرمجاز.");return;}
  try{
    const state=await loadAccessState({strict:true});
    if(!isOwner(uid)&&!state.approved.includes(uid)){await answerCallback(callback.id,"دسترسی ندارید.");return;}
    const match=String(callback.data||"").match(/^allocation:pick:([0-9a-f-]{36}):(image|text|menu)$/);
    if(match?.[2]!=="menu"&&!isBotAdmin(uid,state)){await answerCallback(callback.id,"فقط نمودار درصدی برای مهمان قابل دسترسی است.");return;}
    const selection=await readPrivateJson(ALLOCATION_SELECTION_PREFIX+chat.id+".json");
    const age=Date.now()-Date.parse(selection?.created_at);
    if(!match||selection?.selection_id!==match[1]||selection.used||!Number.isFinite(age)||age<0||age>ALLOCATION_DEADLINE_MS){
      await answerCallback(callback.id,"این منو منقضی شده است؛ آخرین ترکیب دارایی را دوباره انتخاب کنید.");return;
    }
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
async function requestLatestAllocation(chatId,userId,blackRockPriceRial=null,reportFormat="image",{approvedBy=null}={}){
  const state=await loadAccessState({strict:true}),uid=String(userId);
  if(String(chatId)!==uid||(!isOwner(uid)&&!state.approved.includes(uid)))return "دسترسی ندارید.";
  if(approvedBy!==null&&!isBotAdmin(String(approvedBy),state))throw new Error("price_approval_denied");
  if(!isBotAdmin(uid,state)&&(reportFormat!=="chart"||(blackRockPriceRial!==null&&approvedBy===null)))return guestHelp();
  const token=process.env.GITHUB_ACTIONS_TOKEN;
  if(!token)return "دریافت تازه از OneDrive هنوز پیکربندی نشده است. گزارش قبلی به‌عنوان گزارش تازه نمایش داده نمی‌شود.";
  const active=await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+chatId+".json");
  const prior=active?.request_id?await readPrivateJson(ALLOCATION_REQUEST_PREFIX+active.request_id+".json"):null;
  if(prior?.status==="queued"&&Date.now()-Date.parse(prior.requested_at)<ALLOCATION_DEADLINE_MS&&(prior.report_format||"image")===reportFormat)
    return "درخواست دریافت تازه از OneDrive در حال انجام است. لطفاً منتظر پاسخ بمانید.";
  const id=crypto.randomUUID();
  const record={request_id:id,chat_id:chatId,user_id:String(userId),status:"queued",
    requested_at:new Date().toISOString(),blackRockPriceRial,report_format:reportFormat,
    ...(approvedBy!==null?{price_approved_by:String(approvedBy)}:{})};
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
      if(!new Set([...(state.approved||[]).map(String),...adminUserIds()]).has(record.user_id))return;
      const guest=!isBotAdmin(record.user_id,state);
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
      const guestPriceAllowed=guest&&record.price_approved_by&&isBotAdmin(record.price_approved_by,state);
      const report=await latestAllocationReport(quantities,guest&&!guestPriceAllowed?null:record.blackRockPriceRial,guest?"chart":record.report_format||"image",snapshot,{guest});
      const latest=await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+record.chat_id+".json");
      if(latest?.request_id!==id)return;
      if(report.text){
        if(guest){
          if(report.needsEcoCoachPrice){
            await writePrivateJson(ALLOCATION_REQUEST_PREFIX+id+".json",{...record,status:"awaiting_price",ecoCoach_quantity:quantities["بلک راک"]});
            for(const admin of [...new Set([...adminUserIds(),...state.delegatedAdmins])]){
              await sendTelegramWithKeyboard(Number(admin),"برای تکمیل نمودار یک مهمان، قیمت فعلی هر واحد بلک راک* لازم است.\nقیمت و مقدار دارایی برای مهمان نمایش داده نمی‌شود.\n\n"+assetFootnotes(["بلک راک"],{html:false}),[
                [{text:"ثبت قیمت برای این نمودار",callback_data:"admin:guest_price:"+id}]],{temporary:false});
            }
          }
          await sendTelegram(record.chat_id,report.needsEcoCoachPrice?"نمودار منتظر تأیید قیمت توسط مدیر است. پس از ثبت قیمت، نمودار تازه ارسال می‌شود.":"تهیه نمودار فعلاً ممکن نیست. لطفاً بعداً دوباره تلاش کنید.",{menu:true,audience:"guest"});return;
        }
        if(report.text.includes("قیمت فعلی هر واحد صندوق بلک"))await savePendingBlackRock(record.chat_id,{
          type:"latest_blackrock_price",requestedAt:new Date().toISOString(),request_id:id,report_format:record.report_format||"image"});
        await sendTelegram(record.chat_id,report.text,{menu:true,temporary:report.text.includes("قیمت فعلی هر واحد صندوق بلک")});
      }else if(report.messages){
        await savePendingBlackRock(record.chat_id,{type:"none",updatedAt:new Date().toISOString()});
        for(const text of [...report.messages,report.percentages]){
          const current=await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+record.chat_id+".json");
          if(current?.request_id!==id||!await sendTelegram(record.chat_id,text,{menu:true}))return;
        }
      }else{
        await savePendingBlackRock(record.chat_id,{type:"none",updatedAt:new Date().toISOString()});
        await sendTelegramPhoto(record.chat_id,report.png,guest?"نمودار درصد ترکیب دارایی":(record.report_format==="chart"?"نمودار ترکیب دارایی":"آخرین ترکیب دارایی")+" • مقادیر تازه OneDrive و قیمت‌های تازه بازار"+(report.captionFootnotes?"\n\n"+report.captionFootnotes:""),{guestSafe:guest});
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
function emptyAccessState(){return {approved:[],pending:{},delegatedAdmins:[],users:{},audit:[]};}
async function loadAccessState({strict=false}={}){
  try{
    const r=await get(ACCESS_STATE,{access:"private",useCache:false});
    if(!r)return emptyAccessState();
    const reader=r.stream.getReader(),chunks=[];
    while(true){const x=await reader.read();if(x.done)break;chunks.push(Buffer.from(x.value));}
    const raw=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!raw||!Array.isArray(raw.approved)||!raw.pending||typeof raw.pending!=="object"||Array.isArray(raw.pending))throw new Error("invalid_access_state");
    const approved=[...new Set(raw.approved.map(String).filter(x=>/^[1-9]\d*$/.test(x)&&Number.isSafeInteger(Number(x))))];
    const state={approved,pending:raw.pending,
      delegatedAdmins:[...new Set((Array.isArray(raw.delegatedAdmins)?raw.delegatedAdmins:[]).map(String))].filter(x=>approved.includes(x)&&!isOwner(x)),
      users:raw.users&&typeof raw.users==="object"&&!Array.isArray(raw.users)?raw.users:{},
      audit:Array.isArray(raw.audit)?raw.audit.slice(-100):[]};
    Object.defineProperties(state,{_etag:{value:r.blob?.etag},_exists:{value:true}});
    return state;
  }catch(_){
    if(strict)throw new Error("access_state_unavailable");
    const state=emptyAccessState();Object.defineProperty(state,"_unavailable",{value:true});return state;
  }
}
async function saveAccessState(state){
  if(state._unavailable||(state._exists&&!state._etag))throw new Error("access_state_unavailable");
  await put(ACCESS_STATE,JSON.stringify(state,null,2),{access:"private",addRandomSuffix:false,
    ...(state._etag?{ifMatch:state._etag}:{allowOverwrite:false}),contentType:"application/json"});
}
async function requestAccess(uid,user){
  const state=await loadAccessState({strict:true});
  const adminIds=[...new Set([...adminUserIds(),...state.delegatedAdmins])];
  if(!adminIds.length)return "Access requests are not configured yet. Your Telegram user ID is "+uid+". Ask the bot owner to configure admin access.";
  if((state.approved||[]).map(String).includes(uid)||adminIds.includes(uid))return "You are already authorised. Send /help to see available commands.";
  state.pending=state.pending||{};
  if(state.pending[uid])return "Your access request is already pending. The bot admin has been notified.";
  state.pending[uid]={id:uid,first_name:String(user.first_name||""),last_name:String(user.last_name||""),username:String(user.username||""),requestedAt:new Date().toISOString()};
  await saveAccessState(state);
  const display=[user.first_name,user.last_name].filter(Boolean).join(" ")||"Telegram user";
  const who=display+(user.username?" (@"+user.username+")":"")+"\nUser ID: "+uid;
  for(const adminId of adminIds){
    await sendTelegramWithKeyboard(adminId,"درخواست دسترسی جدید\n\n"+who,[[{text:"تأیید به‌عنوان مهمان",callback_data:"admin:approve_guest:"+uid},{text:"تأیید به‌عنوان مدیر",callback_data:"admin:approve_admin:"+uid}],
      [{text:"رد درخواست",callback_data:"access:reject:"+uid}]],{temporary:false});
  }
  return "Your access request has been sent to the bot admin. You will receive a message when it is reviewed.";
}
async function handleAccessCallback(callback){
  const uid=String(callback.from?.id||""),chat=callback.message?.chat;
  if(chat?.type!=="private"||String(chat.id)!==uid){await answerCallback(callback.id,"دسترسی غیرمجاز.");return;}
  let changed=false;
  try{
    const state=await loadAccessState({strict:true});
    if(!isBotAdmin(uid,state)){await answerCallback(callback.id,"دسترسی مدیریت ندارید.");return;}
    const data=String(callback.data||"");
    const previousPanel=callbackPanelToReplace(callback);
    const guestPrice=data.match(/^admin:guest_price:([0-9a-f-]{36})$/);
    if(guestPrice){
      const record=await readPrivateJson(ALLOCATION_REQUEST_PREFIX+guestPrice[1]+".json");
      const current=record?await readPrivateJson(ALLOCATION_ACTIVE_PREFIX+record.chat_id+".json"):null;
      const age=Date.now()-Date.parse(record?.requested_at);
      if(!record||record.status!=="awaiting_price"||current?.request_id!==record.request_id||
        !state.approved.includes(record.user_id)||!Number.isFinite(age)||age<0||age>ALLOCATION_DEADLINE_MS)
        throw new Error("guest_request_expired");
      await savePendingBlackRock(chat.id,{type:"guest_blackrock_price",guest_request_id:record.request_id});
      await answerCallback(callback.id,"");
      await sendTelegramWithKeyboard(chat.id,"قیمت فعلی هر واحد بلک راک* (EcoCoach) را به تومان ارسال کنید.\nتعداد: "+format(record.ecoCoach_quantity)+" واحد\n\n"+assetFootnotes(["بلک راک"],{html:false}),[adminBack()],{previousPanel});return;
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
    const page=data.match(/^admin:(home|users|pending|admins|status|audit)(?::(\d+))?$/);
    if(page){await answerCallback(callback.id,"");await showAdminDashboard(chat.id,uid,page[1],Number(page[2]||0),previousPanel);return;}
    const action=data.match(/^admin:(approve_guest|approve_admin|approve|reject|revoke|confirm_revoke|grant|demote):([1-9]\d*)$/);
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
  }catch(_){await answerCallback(callback.id,changed?"تغییر ثبت شد. برای نمایش وضعیت جدید، پنل را دوباره باز کنید.":
    "عملیات انجام نشد. مجوزها یا وضعیت تغییر کرده است؛ پنل را دوباره باز کنید.");}
}
async function handleAdminAccessCommand(chatId,command,uid){
  let changed=false;
  try{
    const state=await loadAccessState({strict:true});
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
  if(action==="grant"||action==="demote"){
    if(actor===target||!state.approved.includes(target))throw new Error("role_change_denied");
    if(action==="demote"&&!state.delegatedAdmins.includes(target))throw new Error("not_an_admin");
  }else if(action==="revoke"){
    if(!state.approved.includes(target)&&!state.pending[target])throw new Error("unknown_user");
    if(!isOwner(actor)&&state.delegatedAdmins.includes(target))throw new Error("owner_permission_required");
  }else if(action==="reject"){
    if(!state.pending[target]||state.approved.includes(target))throw new Error("request_not_pending");
  }else if(action==="approve_guest"||action==="approve_admin"){
    if(!state.pending[target]||state.approved.includes(target))throw new Error("request_not_pending");
  }else throw new Error("unknown_action");
}
async function changeAccess(actor,target,action,state){
  validateAccessChange(actor,target,action,state);
  if(action==="grant")state.delegatedAdmins=[...new Set([...state.delegatedAdmins,target])];
  else if(action==="demote")state.delegatedAdmins=state.delegatedAdmins.filter(x=>x!==target);
  else if(action==="approve_guest"||action==="approve_admin"){
    state.approved=[...new Set([...state.approved,target])];
    if(state.pending[target])state.users[target]=state.pending[target];
    delete state.pending[target];
    if(action==="approve_admin")state.delegatedAdmins=[...new Set([...state.delegatedAdmins,target])];
  }else{
    if(action==="revoke"){
      state.approved=state.approved.filter(x=>x!==target);
      state.delegatedAdmins=state.delegatedAdmins.filter(x=>x!==target);
    }
    delete state.pending[target];
  }
  state.audit.push({at:new Date().toISOString(),actor_id:actor,target_id:target,action});
  state.audit=state.audit.slice(-100);
  await saveAccessState(state);
  if(action==="revoke"||action==="demote"){
    try{await savePendingBlackRock(target,{type:"none",updatedAt:new Date().toISOString()});}catch(_){}
  }
  const notices={approve_guest:"دسترسی مهمان شما تأیید شد؛ فقط نمودار درصد ترکیب دارایی در دسترس است.",
    approve_admin:"دسترسی شما به‌عنوان مدیر تأیید شد. برای نمایش منو /start را ارسال کنید.",
    reject:"درخواست دسترسی شما رد شد.",revoke:"دسترسی شما به ربات پرتفوی لغو شد.",
    grant:"دسترسی مدیریت برای شما فعال شد. برای نمایش پنل مدیریت /start را ارسال کنید.",
    demote:"نقش شما به مهمان تغییر کرد؛ فقط نمودار درصد ترکیب دارایی در دسترس است."};
  await sendTelegram(Number(target),notices[action],{menu:["grant","approve_guest","approve_admin","demote"].includes(action),
    removeMenu:action==="revoke"||action==="reject",audience:"guest"});
}
async function showApprovalRoles(chatId,target,previousPanel=null){
  const state=await loadAccessState({strict:true});
  if(!isBotAdmin(String(chatId),state)||!state.pending[target])throw new Error("request_not_pending");
  await sendTelegramWithKeyboard(chatId,"نقش کاربر "+target+" را هنگام تأیید انتخاب کنید:",[
    [{text:"تأیید به‌عنوان مهمان",callback_data:"admin:approve_guest:"+target},{text:"تأیید به‌عنوان مدیر",callback_data:"admin:approve_admin:"+target}],
    [{text:"رد درخواست",callback_data:"admin:reject:"+target}]],{previousPanel});
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
  const state=await loadAccessState({strict:true});
  if(!isBotAdmin(uid,state))throw new Error("admin_permission_required");
  const owner=isOwner(uid);
  if(section==="home"){
    const buttons=[[{text:"کاربران مجاز",callback_data:"admin:users:0"},{text:"درخواست‌های دسترسی",callback_data:"admin:pending:0"}],
      [{text:"وضعیت سامانه",callback_data:"admin:status"},{text:"رویدادهای مدیریت",callback_data:"admin:audit"}]];
    buttons.push([{text:"مدیریت نقش‌ها",callback_data:"admin:admins:0"}]);
    await sendTelegramWithKeyboard(chatId,"پنل مدیریت • "+(owner?"مالک":"مدیر منتخب")+
      "\n\nکاربران مجاز: "+new Set([...state.approved,...adminUserIds()]).size+
      "\nدرخواست‌های در انتظار: "+Object.keys(state.pending).length+
      "\nمدیران منتخب: "+state.delegatedAdmins.length,buttons,{previousPanel});return;
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
    const labels={approve:"تأیید دسترسی",approve_guest:"تأیید مهمان",approve_admin:"تأیید مدیر",reject:"رد درخواست",revoke:"لغو دسترسی",grant:"ارتقا به مدیر",demote:"تغییر نقش به مهمان"};
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
  const title=section==="pending"?"درخواست‌های دسترسی":section==="admins"?"مدیریت نقش‌ها":"کاربران مجاز";
  const lines=[],keyboard=[];
  selected.forEach((id,i)=>{
    const role=isOwner(id)?"مالک":state.delegatedAdmins.includes(id)?"مدیر":"مهمان";
    lines.push((i+1)+". "+names[i]+(section==="pending"?"":" • "+role));
    if(section==="pending")keyboard.push([{text:"تأیید مهمان "+(i+1),callback_data:"admin:approve_guest:"+id},{text:"تأیید مدیر "+(i+1),callback_data:"admin:approve_admin:"+id},{text:"رد "+(i+1),callback_data:"admin:reject:"+id}]);
    else if(section==="admins"&&id!==uid)keyboard.push([{text:(state.delegatedAdmins.includes(id)?"تغییر به مهمان ":"ارتقا به مدیر ")+(i+1),callback_data:"admin:"+(state.delegatedAdmins.includes(id)?"demote":"grant")+":"+id}]);
    else if(!isOwner(id)&&(owner||!state.delegatedAdmins.includes(id)))keyboard.push([{text:"لغو دسترسی "+(i+1),callback_data:"admin:revoke:"+id}]);
  });
  const navigation=[];
  if(page>0)navigation.push({text:"صفحه قبل",callback_data:"admin:"+section+":"+(page-1)});
  if((page+1)*ADMIN_PAGE_SIZE<ids.length)navigation.push({text:"صفحه بعد",callback_data:"admin:"+section+":"+(page+1)});
  if(navigation.length)keyboard.push(navigation);
  keyboard.push(adminBack());
  await sendTelegramWithKeyboard(chatId,title+"\nصفحه "+(page+1)+"\n\n"+(lines.join("\n\n")||"موردی وجود ندارد.")+
    (section==="admins"?"\n\nمهمان فقط نمودار درصدی را می‌بیند. نقش مالک و نقش خودتان قابل تغییر نیست.":""),keyboard,{previousPanel});
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

async function valuationReply(q,names,title){
  const {prices,errors}=await getPrices({includeEcoCoach:names.includes("بلک راک")});
  const usdIrr=prices["دلار"]?.priceRial;
  if(!usdIrr) return title+"\n\nUSD/IRR price unavailable; valuation cannot be calculated.";
  const lines=[title+"\n"];
  let total=0;
  const missing=[];
  for(const name of names){
    if(errors[name]||!prices[name]){missing.push(assetLabel(name)+": "+(errors[name]||"price unavailable"));continue;}
    if(q[name]===undefined||!Number.isFinite(Number(q[name]))||Number(q[name])<0){missing.push(assetLabel(name)+": quantity unavailable");continue;}
    const v=valueRial(name,Number(q[name]),prices[name],usdIrr);
    total+=v;
    lines.push(assetLabel(name)+": "+format(q[name])+" × "+formatPrice(name,prices[name])+" = "+formatToman(v));
  }
  if(missing.length){
    lines.push("\nValuation incomplete — subtotal omitted to avoid understating the portfolio.");
    lines.push("Missing data:");
    lines.push(...missing);
  }else{
    lines.push("\nSubtotal: "+formatToman(total));
  }
  lines.push("\nPrices retrieved: "+boldPortfolioTime(new Date()));
  return withAssetFootnotes(lines.join("\n"),names);
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
    return [String(i+1),REPORT_GROUP[a]||"-",assetLabel(a),format(qty),REPORT_UNIT[a]||"-",unit,format(v/10),format(valueUsd(v,usdIrr)),(v/total*100).toFixed(1)+"%",p.source||"-"];
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
    return withAssetFootnotes("Portfolio valuation needs one additional input.\n\nPlease send the current EcoCoach "+assetLabel("بلک راک")+" price per unit in toman.\nQuantity: "+format(q["بلک راک"]||0)+" units\n\nExample: 850000",["بلک راک"]);
  }
  if(!total)return "Allocation unavailable: no current prices were obtained.";
  const reportPrices={...prices};
  if(blackRockPriceRial!==null&&!prices["بلک راک"]) reportPrices["بلک راک"]={priceRial:blackRockPriceRial,source:"User input",retrievedAt:new Date().toISOString(),unit:"IRR/unit"};
  const table=portfolioTable(q,vals,total,reportPrices,usdIrr);
  const sources=[...new Set(Object.keys(vals).map(a=>reportPrices[a]?.source).filter(Boolean))].join(", ");
  const lines=["<b>Portfolio valuation — live prices</b>","","<b>Total:</b> "+formatToman(total)+" | <b>USD:</b> $"+format(valueUsd(total,usdIrr)),"","<i>Unit prices and sources are shown below.</i>","",table];
  if(missing.length)lines.push("\n<b>Not valued:</b> "+missing.map(assetLabel).join(", "));
  lines.push("\n<b>Price sources:</b> "+sources);
  lines.push("<b>Retrieved:</b> "+boldPortfolioTime(new Date()));
  return withAssetFootnotes(lines.join("\n"),[...Object.keys(vals),...missing]);
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
  return ALLOCATION_CATEGORIES.map(category=>{
    const value=Object.entries(vals).filter(([asset])=>categoryName(asset)===category).reduce((sum,[,amount])=>sum+amount,0);
    return {category,label:ALLOCATION_LABELS[category],value,percentage:value/total*100};
  });
}
function assetsReply(quantities,snapshot){
  const categories=[
    ["طلا و سکه","طلا و سکه"],["نقره","نقره"],["سهام و صندوق","سهام و صندوق‌ها"],
    ["رمز ارز","رمزارزها"],["Tether","تتر"],["US Dollar","دلار"]
  ];
  let index=0;
  const sections=categories.map(([category,title])=>"<b><i><u>"+escXml(title)+"</u></i></b>\n\n"+ASSETS
    .filter(asset=>categoryName(asset)===category)
    .map(asset=>(++index)+". "+assetLabel(asset)+": "+(quantities[asset]===undefined?"همگام‌سازی نشده":format(quantities[asset])))
    .join("\n"));
  return withAssetFootnotes("دارایی‌های پرتفوی (۲۹ مورد)\n\n"+sections.join("\n\n")+
    (snapshot?"\n\nSnapshot: "+boldPortfolioTime(snapshot.updated_at):""),ASSETS);
}
function escXml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function svgText(x,y,text,size,opts={}){
  const anchor=opts.anchor||"start",weight=opts.weight||400,fill=opts.fill||"#18324a";
  return '<text x="'+x+'" y="'+y+'" font-family="Estedad" font-size="'+size+'" font-weight="'+weight+'" fill="'+fill+'" text-anchor="'+anchor+'">'+escXml(text)+"</text>";
}
function compactNumber(n){return Number(n).toLocaleString("fa-IR",{maximumFractionDigits:2});}
function moneyFa(n){return compactNumber(n)+" تومان";}
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

function buildPortfolioSvg(q,vals,total,prices,usdIrr){
  const priceTime=portfolioTime(new Date());
  const enNum=n=>Number(n).toLocaleString("fa-IR",{maximumFractionDigits:2});
  const toman=n=>(Math.round(Number(n)/1000)*1000).toLocaleString("fa-IR")+" تومان";
  const usdText=n=>Number(n).toLocaleString("fa-IR",{minimumFractionDigits:2,maximumFractionDigits:2})+" دلار";
  const unitPriceFa=(asset,p)=>cryptoAsset(asset)
    ? Number(p.priceUsd).toLocaleString("fa-IR",{maximumFractionDigits:8})+" دلار"
    : Number(p.priceRial/10).toLocaleString("fa-IR",{maximumFractionDigits:8})+" تومان";
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
      rank:i+1,asset:a,group:REPORT_GROUP[a]||"-",
      qty:qSafe(q[a]),qtyDecimals:a==="ETH"?3:a==="BTC"?4:null,unit:cryptoAsset(a)?a:REPORT_UNIT[a]||"-",
      unitPrice:unitPriceFa(a,p),valueToman:v/10,valueUsd:usd,pct:total?v/total*100:0,
      source:sourceFa(p.source)
    };
  });

  // The table is deliberately placed BELOW the dashboard panels. This prevents
  // the 29-row table from ever covering the chart, cards, or summary.
  const noteY=1965;
  const noteLines=[
    "• قیمت واحد رمزارزها به دلار نمایش داده می‌شود.",
    "• ارزش دلاری سایر دارایی‌ها از تقسیم ارزش تومانی بر نرخ دلار آزاد به دست می‌آید.",
    "• ارزش دلاری رمزارزها حاصل ضرب مقدار در قیمت دلاری هر واحد است.",
    ...assetCommentEntries(rows.map(row=>row.asset)).flatMap(({label,comment})=>wrapReportText(label+": "+comment)),
    "اعداد یادداشت‌های خرید تاریخی هستند و در ارزش‌گذاری روز استفاده نمی‌شوند."
  ];
  const noteH=80+noteLines.length*28;
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
  svg+=svgText(70,160,"قیمت دلار: "+Math.round(usdIrr/10).toLocaleString("fa-IR")+" تومان",18,{anchor:"start",fill:"#dce9f4"});
  svg+=svgText(70,200,"قیمت واحد رمزارزها به دلار است",18,{anchor:"start",fill:"#dce9f4"});

  const cards=catOrder.map(name=>[name,cats[name]||0]);
  let cardX=20;
  for(const [name,val] of cards){
    const pct=total?val/total*100:0;
    const cardW=285;
    const cardToman=(Math.round((val/10)/1000)*1000).toLocaleString("fa-IR");
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
  svg+=svgText(cx0,cy0-7,enNum(Math.round(total/10/1000)*1000),17,{anchor:"middle",weight:700});
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
  const summary=[["ارزش کل",toman(total/10)],["ارزش دلاری",usdText(valueUsd(total,usdIrr))],["تعداد دارایی‌ها",enNum(rows.length)],["نرخ دلار (تومان)",Math.round(usdIrr/10).toLocaleString("fa-IR")],["زمان قیمت‌ها",priceTime]];
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
      if(k==="asset")v=assetLabel(v);
      if(k==="valueToman")v=(Math.round(Number(v)/1000)*1000).toLocaleString("fa-IR");
      else if(k==="valueUsd")v=usdText(v);
      else if(k==="pct")v=r.pct.toLocaleString("fa-IR",{minimumFractionDigits:1,maximumFractionDigits:1})+"٪";
      else if(k==="qty")v=r.qtyDecimals===null?enNum(v):Number(v).toLocaleString("fa-IR",{minimumFractionDigits:r.qtyDecimals,maximumFractionDigits:r.qtyDecimals});
      const font=(k==="asset"||k==="group"||k==="source")?12:13;
      v=fit(v,w,font);
      svg+=svgText(xmap[k]+w-8,y+25,String(v),font,{anchor:"end",fill:"#243b53"});
    }
  });

  svg+='<rect data-section="footnotes" x="40" y="'+noteY+'" width="1720" height="'+noteH+'" rx="16" fill="#edf4f8" stroke="#d7e2eb"/>';
  svg+=svgText(1730,noteY+38,"توضیحات",20,{anchor:"end",weight:700});
  noteLines.forEach((line,index)=>{svg+=svgText(1730,noteY+70+index*28,line,16,{anchor:"end"});});
  svg+='</svg>';
  return svg;
}
async function prepareAllocation(q,blackRockPriceRial){
  const {prices,errors}=await getPrices();
  const effectiveBlackRockPrice=prices["بلک راک"]?.priceRial??blackRockPriceRial;
  const usdIrr=prices["دلار"]?.priceRial;
  if(!usdIrr)return {text:"دریافت نرخ دلار آزاد ناموفق بود؛ ارزش‌گذاری انجام نشد."};
  const missingQuantities=ASSETS.filter(a=>q[a]===undefined||!Number.isFinite(Number(q[a]))||Number(q[a])<0);
  if(missingQuantities.length)return {text:withAssetFootnotes("ارزش‌گذاری انجام نشد؛ مقدار این دارایی‌ها موجود یا معتبر نیست: "+missingQuantities.map(assetLabel).join("، "),missingQuantities)};
  const missingPrices=ASSETS.filter(a=>{
    if(a==="بلک راک")return effectiveBlackRockPrice===null||effectiveBlackRockPrice===undefined;
    return !!errors[a]||!prices[a];
  });
  if(missingPrices.length){
    const otherMissing=missingPrices.filter(a=>a!=="بلک راک");
    if(!otherMissing.length&&missingPrices.includes("بلک راک"))return {needsEcoCoachPrice:true,text:withAssetFootnotes("برای تهیه گزارش، قیمت فعلی هر واحد صندوق "+assetLabel("بلک راک")+" (EcoCoach) را به تومان ارسال کنید.\n\nتعداد: "+format(q["بلک راک"])+" واحد",["بلک راک"])};
    const lines=["گزارش ارزش‌گذاری کامل تهیه نشد. برای جلوگیری از نمایش جمع و درصدهای ناقص، هیچ جمع کل یا نموداری ارائه نمی‌شود."];
    if(otherMissing.length)lines.push("قیمت ناموجود/نامعتبر: "+otherMissing.map(a=>assetLabel(a)+" ("+(errors[a]||"قیمت دریافت نشد")+")").join("؛ "));
    if(missingPrices.includes("بلک راک"))lines.push("لطفاً قیمت فعلی هر واحد صندوق "+assetLabel("بلک راک")+" (EcoCoach) را به تومان ارسال کنید. تعداد: "+format(q["بلک راک"])+" واحد");
    return {text:withAssetFootnotes(lines.join("\n\n"),missingPrices)};
  }
  let total=0;const vals={};
  for(const a of ASSETS){
    if(a==="بلک راک")continue;
    const qty=Number(q[a]);
    vals[a]=valueRial(a,qty,prices[a],usdIrr);
    total+=vals[a];
  }
  if(effectiveBlackRockPrice!==null){const v=qSafe(q["بلک راک"])*effectiveBlackRockPrice;vals["بلک راک"]=v;total+=v;delete errors["بلک راک"];}
  if(!total)return {text:"هیچ قیمت معتبر فعلی برای ارزش‌گذاری دریافت نشد."};
  const reportPrices={...prices};if(!prices["بلک راک"]&&blackRockPriceRial!==null)reportPrices["بلک راک"]={priceRial:blackRockPriceRial,source:"User input",retrievedAt:new Date().toISOString(),unit:"IRR/unit"};
  if(!Number.isFinite(total)||total<=0||Object.values(vals).some(value=>!Number.isFinite(value)||value<0))
    return {text:"ارزش‌گذاری کامل و معتبر نیست؛ هیچ جمع کل، درصد یا نموداری ارائه نمی‌شود."};
  return {vals,total,prices:reportPrices,usdIrr,priceTime:new Date().toISOString()};
}
function renderAllocationSvg(svg){
  const fontPath=path.join(process.cwd(),"assets/fonts/Estedad-Regular.ttf");
  const boldFontPath=path.join(process.cwd(),"assets/fonts/Estedad-Bold.ttf");
  const rendered=new Resvg(svg,{font:{fontFiles:[fontPath,boldFontPath],loadSystemFonts:false,defaultFontFamily:"Estedad",sansSerifFamily:"Estedad"}}).render();
  return rendered.asPng();
}
function allocationTextReport(q,report,snapshot){
  const number=value=>Number(value).toLocaleString("fa-IR",{maximumFractionDigits:8});
  const header="<b>گزارش تفصیلی آخرین ترکیب دارایی</b>\n"+
    (snapshot?"همگام‌سازی مقادیر: "+boldPortfolioTime(snapshot.updated_at)+"\n":"")+
    "قیمت‌های بازار: "+boldPortfolioTime(report.priceTime)+"\n"+
    "ارزش کل پرتفوی: <b>"+number(report.total/10)+" تومان</b>";
  const messages=[];let chunk=header;
  ASSETS.forEach((asset,index)=>{
    const quote=report.prices[asset];
    const unit=cryptoAsset(asset)?asset:REPORT_UNIT[asset];
    const price=quote.priceUsd!==undefined?number(quote.priceUsd)+" دلار":number(quote.priceRial/10)+" تومان";
    const block=number(index+1)+". <b>"+escXml(assetLabel(asset))+"</b>\n"+
      "مقدار: "+number(q[asset])+" "+escXml(unit)+" • گروه: "+escXml(REPORT_GROUP[asset])+"\n"+
      "ارزش: <b>"+number(report.vals[asset]/10)+" تومان</b>\n"+
      "قیمت واحد: "+price+" • منبع: "+escXml(sourceFa(quote.source));
    if((chunk+"\n\n"+block).length>3500){messages.push(chunk);chunk="<b>ادامه گزارش ترکیب دارایی</b>";}
    chunk+="\n\n"+block;
  });
  const notes=assetFootnotes(ASSETS);
  if((chunk+"\n\n"+notes).length>3500){messages.push(chunk);chunk=notes;}
  else chunk+="\n\n"+notes;
  messages.push(chunk);
  const percentages="<b>درصد گروه‌های دارایی</b>\n\n"+allocationGroups(report.vals,report.total).map(group=>
    "<b>"+group.label+"</b>: "+group.percentage.toLocaleString("fa-IR",{minimumFractionDigits:2,maximumFractionDigits:2})+"٪"
  ).join("\n")+"\n\nقیمت‌های بازار: "+boldPortfolioTime(report.priceTime);
  return {messages,percentages,total:report.total};
}
async function latestAllocationReport(q,blackRockPriceRial,format="image",snapshot=null,{guest=false}={}){
  const report=await prepareAllocation(q,blackRockPriceRial);
  if(report.text)return guest?{text:"تهیه نمودار فعلاً ممکن نیست؛ قیمت یکی از دارایی‌ها نیازمند تأیید مدیر است.",needsEcoCoachPrice:report.needsEcoCoachPrice===true}:report;
  if(guest)return {png:renderAllocationSvg(buildAllocationPieSvg(report,snapshot,{guest:true})),guestSafe:true};
  if(format==="text")return allocationTextReport(q,report,snapshot);
  if(format==="chart")return {png:renderAllocationSvg(buildAllocationPieSvg(report,snapshot)),total:report.total,captionFootnotes:assetFootnotes(ASSETS,{html:false})};
  return {png:renderAllocationSvg(buildPortfolioSvg(q,report.vals,report.total,report.prices,report.usdIrr)),total:report.total};
}
async function allocationImageReply(q,blackRockPriceRial){
  return latestAllocationReport(q,blackRockPriceRial,"image");
}

function buildAllocationPieSvg(report,snapshot=null,{guest=false}={}){
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
    svg+=svgText(1510,1075,"ارزش کل پرتفوی",21,{anchor:"end",weight:700,fill:theme.muted});
    svg+=svgText(1510,1110,moneyFa(report.total/10),29,{anchor:"end",weight:700,fill:theme.ink});
    svg+=svgText(78,1087,"درصد گروه‌ها بر اساس ارزش تومانی • دو رقم اعشار",20,{fill:theme.muted});
  }
  return svg+'</svg>';
}

function formatPrice(asset,p){
  return p.priceUsd!==undefined?"$"+format(p.priceUsd):formatToman(p.priceRial);
}
function formatToman(rial){return format(rial/10)+" toman";}
function format(v){return Number(v).toLocaleString("en-US",{maximumFractionDigits:8});}
function group(q,names){return withAssetFootnotes(names.map(n=>assetLabel(n)+": "+(q[n]===undefined?"not synchronized":format(q[n]))).join("\n"),names);}
function guestHelp(){return "دسترسی شما مهمان است. فقط نمودار درصد ترکیب دارایی در دسترس است؛ از دکمه زیر استفاده کنید.";}
function help(){return withAssetFootnotes("Portfolio Agent is online.\nبرای انتخاب گزارش، از دکمه‌های منو استفاده کنید.\n\n/status — portfolio status\n/assets — asset list\n/latest_allocation — آخرین ترکیب دارایی: انتخاب گزارش تصویری یا متنی با مقادیر و قیمت‌های تازه\n/gold_and_other_precious_metals — gold and other precious metals\n/crypto — live crypto valuation\n/allocation_chart — نمودار سه‌بعدی ترکیب دارایی با مقادیر و قیمت‌های تازه\n/cash_dollar — Cash Dollar (دلار نقدی)\n\nبرای تهیه گزارش ارزش‌گذاری، ربات قیمت فعلی هر واحد "+assetLabel("بلک راک")+" (EcoCoach) را به تومان از شما می‌پرسد.",["بلک راک"]);}
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
  if(!isOwner(String(chatId))&&!state.approved.includes(String(chatId)))return null;
  const admin=isBotAdmin(String(chatId),state);
  const keyboard=admin?BUTTON_MENU.map(row=>row.map(button=>({text:button.text}))):[[{text:"نمودار ترکیب دارایی"}]];
  if(admin)keyboard.at(-1).push({text:"پنل مدیریت"});
  return {keyboard,
    resize_keyboard:true,is_persistent:false,one_time_keyboard:false,
    input_field_placeholder:admin?"یک گزینه انتخاب کنید یا قیمت "+assetLabel("بلک راک")+" را وارد کنید":"نمایش نمودار درصد ترکیب دارایی"};
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
async function deliverTelegram(chatId,method,options,{temporary=false,menuAnchor=false}={}){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token)return false;
  try{
    const r=await fetch("https://api.telegram.org/bot"+token+"/"+method,options);
    const result=await r.json();
    if(!r.ok||!result.ok){console.warn("Telegram delivery failed",method,r.status);return false;}
    await cleanupTemporaryReplies(chatId,result.result?.message_id,temporary);
    if(menuAnchor)await replaceMainMenuAnchor(chatId,result.result?.message_id);
    return true;
  }catch(_){console.warn("Telegram delivery unavailable",method);return false;}
}

async function sendTelegram(chatId,text,{menu=false,temporary=false,removeMenu=false,menuAnchor=false,audience="admin"}={}){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token){console.error("TELEGRAM_BOT_TOKEN is not configured");return;}

  const send=async msg=>{
    const markup=menu?await portfolioKeyboard(chatId):removeMenu?{remove_keyboard:true}:null;
    if(menu&&!markup)return false;
    if(menu&&audience!=="guest"){
      try{if(!isBotAdmin(String(chatId),await loadAccessState({strict:true})))return false;}catch(_){return false;}
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

async function sendTelegramPhoto(chatId,png,caption,{guestSafe=false}={}){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token){console.error("TELEGRAM_BOT_TOKEN is not configured");return;}
  const form=new FormData();
  const keyboard=await portfolioKeyboard(chatId);
  if(!keyboard)return false;
  if(!guestSafe){try{if(!isBotAdmin(String(chatId),await loadAccessState({strict:true})))return false;}catch(_){return false;}}
  form.append("chat_id",String(chatId));
  form.append("photo",new Blob([png],{type:"image/png"}),"portfolio-report.png");
  form.append("reply_markup",JSON.stringify(keyboard));
  if(caption)form.append("caption",caption);
  return deliverTelegram(chatId,"sendPhoto",{method:"POST",body:form});
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
