import { put, get } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";

const SNAPSHOT = "portfolio/latest.json";
const BLACKROCK_PENDING_PREFIX = "portfolio/pending-blackrock/";
const ASSETS = [
  "طلا","عیار","گوهر","آلتون","امرالد","زرفام","نهال","طعام","استیل",
  "فلز فارابی","پتروآگاه","خودران","بلک راک","سجام","فملی","شمش نقره 999",
  "BTC","ETH","Tether","Link","ADA","SOL","ONDO",
  "سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","دلار"
];
const MANUAL = {"سکه تمام":3,"ربع سکه غیره":3,"ربع سکه بانکی":1,"آبشده (طلب)":1.37,"آبشده (شمش زربد)":20,"دلار":3030};

const LISTED = {
  "عیار":"عیار","گوهر":"گوهر","آلتون":"آلتون","امرالد":"امرالد",
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
  const n=parseNum(String(text||"").replace(/تومان|ریال/gi,"").replace(/\s/g,""));
  if(n===null||n<=0)return null;
  // User is asked for toman/unit. If they explicitly provide rial, convert it.
  if(/ریال/i.test(text))return n;
  return n*10;
}
async function telegram(req,res){
  const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
  if(secret&&req.headers["x-telegram-bot-api-secret-token"]!==secret)return res.status(401).json({ok:false});
  const message=req.body?.message;
  if(!message?.chat?.id)return res.status(200).json({ok:true});
  const command=(message.text||"").trim();
  waitUntil((async()=>{
    const snapshot=await safeSnapshot();
    const quantities={...(snapshot?.assets||{}),...MANUAL};
    let reply;
    const pending=await loadPendingBlackRock(message.chat.id);

    // A pending BlackRock request is fulfilled by the next user message.
    if(pending?.type==="blackrock_price"){
      const priceRial=parseUserPrice(command);
      if(priceRial===null){
        reply="Please send the current EcoCoach بلک راک price per unit in toman (for example: 850000).";
      }else{
        reply=await allocationReply(quantities,priceRial);
        await savePendingBlackRock(message.chat.id,{type:"none",updatedAt:new Date().toISOString()});
      }
    }else if(command==="/start"||command==="/help") reply=help();
    else if(command==="/status") reply=snapshot?("Portfolio Agent is connected.\\n\\nTrading Journal snapshot: "+snapshot.updated_at+(snapshot.workbook_updated_at?"\\nWorkbook: "+snapshot.workbook_updated_at:"")):"Portfolio Agent is connected, but no Trading Journal snapshot has been synchronized yet.";
    else if(command==="/assets") reply="Portfolio assets (29)\\n\\n"+ASSETS.map((x,i)=>(i+1)+". "+x+": "+(quantities[x]===undefined?"not synchronized":format(quantities[x]))).join("\\n")+(snapshot?"\\n\\nSnapshot: "+snapshot.updated_at:"");
    else if(command==="/gold") reply=await valuationReply(quantities,["طلا","عیار","گوهر","آلتون","امرالد","زرفام","نهال","طعام","سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","شمش نقره 999"],"Gold & precious metals");
    else if(command==="/crypto") reply=await valuationReply(quantities,["BTC","ETH","Tether","Link","ADA","SOL","ONDO"],"Crypto");
    else if(command==="/cash") reply=await valuationReply(quantities,["دلار"],"Cash");
    else if(command==="/allocation"||command==="/refresh"){
      reply=await allocationReply(quantities);
      if(reply.startsWith("Portfolio valuation needs one additional input.")){
        await savePendingBlackRock(message.chat.id,{type:"blackrock_price",requestedAt:new Date().toISOString()});
      }
    }
    else reply=help();
    await sendTelegram(message.chat.id,reply);
  })().catch(e=>console.error("Telegram handler error:",e)));
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
  const html=await fetchText("https://www.tgju.org/profile/"+slug);
  const plain=normMarketText(String(html||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," "));
  const candidates=[];
  const markerRe=/نرخ فعلی/g;
  let m;
  while((m=markerRe.exec(plain))!==null){
    const tail=plain.slice(m.index,m.index+1200);
    for(const hit of tail.matchAll(/[۰-۹٠-٩0-9][۰-۹٠-٩0-9,٬،]*/g)){
      const n=parseNum(hit[0]);
      if(n!==null)candidates.push(n);
    }
  }
  const valid=candidates.filter(x=>!range||(x>=range[0]&&x<=range[1]));
  const rial=valid[0];
  if(rial===undefined)throw new Error("TGJU current price not found or failed validation");
  return {priceRial:rial,source:"TGJU",retrievedAt:new Date().toISOString()};
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
  const rowMatch=[...String(html||"").matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map(m=>m[0])
    .find(row=>normMarketText(row).includes("SilverBar"));
  if(!rowMatch)throw new Error("SilverBar row not found");
  const text=normMarketText(rowMatch
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," "));
  const nums=[...text.matchAll(/[۰-۹٠-٩0-9][۰-۹٠-٩0-9,٬،]*(?:\.[۰-۹٠-٩0-9]+)?/g)]
    .map(m=>parseNum(m[0])).filter(x=>x!==null);
  // The row description contains silver purity (999.9), so the first numeric token is not the market price.\n  const priceRial=nums.find(x=>x>=100000);
  if(!priceRial||priceRial<=0)throw new Error("SilverBar last trade not found");
  return {priceRial,source:"Shakhesban IME",symbol:"SilverBar",retrievedAt:new Date().toISOString(),unit:"IRR/g"};
}

async function getListedPrice(asset,marketHtmls){
  const symbol=LISTED[asset];
  const type=SHAKHESBAN_TYPE[asset];
  try{return await shakhesban(symbol,type);}
  catch(e){
    try{
      if(!marketHtmls?.length)throw new Error("TGJU market pages unavailable");
      return await tgjuMarket(symbol,marketHtmls);
    }catch(e2){
      try{return await tsetmc(symbol);}
      catch(e3){
        console.error("Listed price failed:",asset,"Shakhesban:",e.message,"/ TGJU:",e2.message,"/ TSETMC:",e3.message);
        throw new Error(asset+" price unavailable");
      }
    }
  }
}

async function getPrices(){
  const prices={};
  const errors={};
  const goldDefs={
    "طلا":{slug:"ime_fund_lotuss",range:[500000,5000000],unit:"IRR/unit",source:"TGJU صندوق طلای لوتوس"},
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

async function allocationReply(q,blackRockPriceRial=null){
  const {prices,errors}=await getPrices();
  const usdIrr=prices["دلار"]?.priceRial;
  if(!usdIrr)return "Allocation unavailable: current USD/IRR price could not be obtained.";
  let total=0;const vals={};
  for(const a of ASSETS){
    if(errors[a]||!prices[a])continue;
    vals[a]=valueRial(a,q[a]||0,prices[a],usdIrr); total+=vals[a];
  }
  if(blackRockPriceRial!==null){
    const v=(q["بلک راک"]||0)*blackRockPriceRial;
    vals["بلک راک"]=v;
    total+=v;
    delete errors["بلک راک"];
  }
  const missing=ASSETS.filter(a=>errors[a]||!prices[a]);
  if(errors["بلک راک"]==="USER_INPUT_REQUIRED" && blackRockPriceRial===null){
    return "Portfolio valuation needs one additional input.\\n\\nPlease send the current EcoCoach بلک راک price per unit in toman.\\nQuantity: "+format(q["بلک راک"]||0)+" units\\n\\nExample: 850000";
  }
  if(!total)return "Allocation unavailable: no current prices were obtained.";
  const lines=["Portfolio valuation (live prices)",""];
  lines.push("Total valued: "+formatToman(total));
  lines.push("");
  for(const [a,v] of Object.entries(vals).sort((x,y)=>y[1]-x[1])) lines.push(a+": "+formatToman(v)+" ("+(v/total*100).toFixed(1)+"%)");
  if(missing.length)lines.push("\nNot valued: "+missing.join(", "));
  lines.push("\nPrice retrieval: "+new Date().toISOString());
  return lines.join("\n");
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
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chatId,text})});
  if(!r.ok)console.error("Telegram API error:",await r.text());
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