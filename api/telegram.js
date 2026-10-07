import { put, get } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";

const SNAPSHOT = "portfolio/latest.json";
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
    if(command==="/start"||command==="/help") reply=help();
    else if(command==="/status") reply=snapshot?("Portfolio Agent is connected.\\n\\nTrading Journal snapshot: "+snapshot.updated_at+(snapshot.workbook_updated_at?"\\nWorkbook: "+snapshot.workbook_updated_at:"")):"Portfolio Agent is connected, but no Trading Journal snapshot has been synchronized yet.";
    else if(command==="/assets") reply="Portfolio assets (29)\\n\\n"+ASSETS.map((x,i)=>(i+1)+". "+x+": "+(quantities[x]===undefined?"not synchronized":format(quantities[x]))).join("\\n")+(snapshot?"\\n\\nSnapshot: "+snapshot.updated_at:"");
    else if(command==="/gold") reply=await valuationReply(quantities,["طلا","عیار","گوهر","آلتون","امرالد","زرفام","نهال","طعام","سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","شمش نقره 999"],"Gold & precious metals");
    else if(command==="/crypto") reply=await valuationReply(quantities,["BTC","ETH","Tether","Link","ADA","SOL","ONDO"],"Crypto");
    else if(command==="/cash") reply=await valuationReply(quantities,["دلار"],"Cash");
    else if(command==="/allocation"||command==="/refresh") reply=await allocationReply(quantities);
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
  const marker=html.indexOf("نرخ فعلی");
  if(marker<0)throw new Error("TGJU current-rate marker not found");
  const tail=html.slice(marker,marker+500);
  const candidates=[...tail.matchAll(/[۰-۹٠-٩0-9][۰-۹٠-٩0-9,٬،]*/g)].map(m=>parseNum(m[0])).filter(x=>x!==null);
  const rial=candidates.filter(x=>!range||(x>=range[0]&&x<=range[1])).sort((x,y)=>y-x)[0];
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

async function tgjuMarket(symbol){
  const html=await fetchText("https://www.tgju.org/markets/all");
  const plain=html
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/\s+/g," ")
    .trim();
  const marker=plain.indexOf(" "+symbol+" ");
  if(marker<0)throw new Error("TGJU market symbol not found");
  const tail=plain.slice(marker+symbol.length,marker+symbol.length+500);
  const nums=[...tail.matchAll(/[۰-۹٠-٩0-9][۰-۹٠-٩0-9,٬،]*(?:\\.[۰-۹٠-٩0-9]+)?/g)]
    .map(m=>parseNum(m[0])).filter(x=>x!==null);
  if(!nums.length)throw new Error("TGJU market price not found");
  const priceRial=nums[0];
  if(!Number.isFinite(priceRial)||priceRial<=0)throw new Error("TGJU market price invalid");
  return {priceRial,source:"TGJU markets/all",symbol,retrievedAt:new Date().toISOString()};
}

async function getListedPrice(asset){
  const symbol=LISTED[asset];
  try{return await tgjuMarket(symbol);}
  catch(e){
    try{return await tsetmc(symbol);}
    catch(e2){throw new Error(asset+" price unavailable");}
  }
}

async function getPrices(){
  const prices={};
  const errors={};
  const goldDefs={
    "طلا":{slug:"geram18",range:[100000000,1000000000],unit:"IRR/g"},
    "شمش نقره 999":{slug:"silver_999",range:[1000000,50000000],unit:"IRR/g"},
    "سکه تمام":{slug:"sekee",range:[1000000000,10000000000],unit:"IRR/coin"},
    "آبشده (طلب)":{slug:"gold_futures",range:[500000000,2000000000],unit:"IRR/mithqal",perGram:true},
    "آبشده (شمش زربد)":{slug:"gold_futures",range:[500000000,2000000000],unit:"IRR/mithqal",perGram:true},
    "دلار":{slug:"price_dollar_rl",range:[500000,5000000],unit:"IRR/USD"}
  };
  const jobs=Object.entries(goldDefs).map(async([asset,d])=>{
    try{
      const p=await tgju(d.slug,d.range);
      if(d.perGram)p.priceRial=p.priceRial/4.6083;
      prices[asset]={...p,unit:d.perGram?"IRR/g":d.unit};
    }catch(e){errors[asset]=e.message;}
  });
  jobs.push(...Object.keys(LISTED).map(async asset=>{
    try{prices[asset]=await getListedPrice(asset);}catch(e){errors[asset]=e.message;}
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
  errors["بلک راک"]="EcoCoach-specific live price source is not yet connected";
  errors["ربع سکه غیره"]="A reliable live non-bank quarter-coin quote is not yet connected";
  errors["ربع سکه بانکی"]="A reliable live bank quarter-coin quote is not yet connected";
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

async function allocationReply(q){
  const {prices,errors}=await getPrices();
  const usdIrr=prices["دلار"]?.priceRial;
  if(!usdIrr)return "Allocation unavailable: current USD/IRR price could not be obtained.";
  let total=0;const vals={};
  for(const a of ASSETS){
    if(errors[a]||!prices[a])continue;
    vals[a]=valueRial(a,q[a]||0,prices[a],usdIrr); total+=vals[a];
  }
  const missing=ASSETS.filter(a=>errors[a]||!prices[a]);
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
function help(){return "Portfolio Agent is online.\n\n/status — portfolio status\n/assets — asset list\n/allocation — live portfolio valuation & allocation\n/gold — live gold & precious-metal valuation\n/crypto — live crypto valuation\n/cash — live cash valuation\n/refresh — refresh live market data and portfolio valuation";}
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