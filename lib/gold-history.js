import marketClosures from './iran-market-closures.json' with {type:'json'};

export const HISTORY_CALENDAR='wednesday-v1';
export const LAST_KNOWN_POLICY='last-known-before-valuation-v1';
export function validateHistoryPriceInputs(records,assets,now=Date.now()){
  if(!Array.isArray(records)||!records.length||records.length>1000)throw new Error('invalid_gold_history_record');
  const seen=new Set();
  return records.map(raw=>{
    const stamp=Date.parse(raw?.quoted_at),factor=raw?.original_currency==='IRR'?1:raw?.original_currency==='TOMAN'?10:NaN;
    if(!assets.includes(raw?.asset)||typeof raw?.quoted_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.quoted_at)||!Number.isFinite(stamp)||stamp>now||!Number.isFinite(raw.price_rial)||raw.price_rial<=0||raw.price_rial>Number.MAX_SAFE_INTEGER||
      !Number.isFinite(raw.original_price)||raw.original_price<=0||raw.original_price*factor!==raw.price_rial||!/^[a-f0-9]{64}$/.test(raw.document_sha256||''))throw new Error('invalid_gold_history_record');
    const key=raw.asset+'|'+stamp;if(seen.has(key))throw new Error('invalid_gold_history_record');seen.add(key);
    return {asset:raw.asset,price_rial:raw.price_rial,quoted_at:new Date(stamp).toISOString(),source:'Owner supplied dated historical unit price',
      original_price:raw.original_price,original_currency:raw.original_currency,document_sha256:raw.document_sha256};
  });
}
const tehranDay=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
export function closureForQuote(asset,asof,quoted){
  const day=tehranDay(asof),priceDay=tehranDay(quoted);
  return marketClosures.closures.find(c=>c.assets.includes(asset)&&c.start<=day&&day<=c.end&&priceDay===c.last_open);
}

// The old Friday observations remain in a private archive, never relabelled.
export function historyCalendarBase(existing,incoming,calendar){
  if(!existing.some(w=>new Date(w.week_ending+'T12:00:00Z').getUTCDay()!==3))return existing;
  const expected=Array.from({length:52},(_,i)=>new Date(Date.parse('2025-10-29T12:00:00Z')+i*7*86400000).toISOString().slice(0,10));
  if(calendar!==HISTORY_CALENDAR||incoming.length!==52||new Set(incoming.map(w=>w.week_ending)).size!==52||incoming.some(w=>w.mode!=='historical'||!expected.includes(w.week_ending)))throw new Error('invalid_gold_history_record');
  return existing.filter(w=>new Date(w.week_ending+'T12:00:00Z').getUTCDay()===3);
}

// Pure validation/calculation. All quantities stay intact; only report values
// use the owner's minimum-value rule. Missing data never becomes a zero total.
export function calculateGoldWeek(input,{assets,groups,additionalGroups={},minimumRial=500000,now=Date.now(),historicalPricePolicy=null,priceInputsRevision=null}={}){
  const fail=()=>{throw new Error('invalid_gold_history_record');};
  const stamp=Date.parse(input?.as_of),checked=Date.parse(input?.source_checked_at),modified=Date.parse(input?.workbook_updated_at);
  const week=String(input?.week_ending||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(week)||new Date(week+'T12:00:00Z').getUTCDay()!==3||
    !Number.isFinite(stamp)||stamp>now||!Number.isFinite(checked)||checked>now||!Number.isFinite(modified)||modified>checked||
    !/^[a-f0-9]{64}$/.test(input.workbook_sha256||'')||!['historical','live','baseline'].includes(input.mode))fail();
  const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
  const offset=(Date.parse(localDate+'T12:00:00Z')-Date.parse(week+'T12:00:00Z'))/86400000;
  if(input.mode==='historical'&&offset!==0||input.mode==='live'&&offset!==0||input.mode==='baseline'&&(offset>0||offset< -6))fail();
  if(!input.quantities||Object.keys(input.quantities).length!==assets.length||Object.keys(input.quantities).some(a=>!assets.includes(a)))fail();
  if(input.additional_quantities!==undefined&&(!input.additional_quantities||typeof input.additional_quantities!=='object'||Array.isArray(input.additional_quantities)||Object.keys(input.additional_quantities).some(a=>!Object.hasOwn(additionalGroups,a))))fail();
  const extra=Object.fromEntries(Object.keys(additionalGroups).map(a=>[a,input.additional_quantities?.[a]??null]));
  const allGroups={...groups,...additionalGroups};
  const quantities={},quotes={},values={},missing=[],estimated=[];
  const quote=(raw,asset)=>{
    if(!raw||!Number.isFinite(raw.price_rial)||raw.price_rial<=0||typeof raw.source!=='string'||!raw.source||raw.source.length>120)return null;
    const time=Date.parse(raw.quoted_at);
    if(!Number.isFinite(time)||time>stamp)return null;
    const closure=input.mode==='historical'&&['Shakhesban historical daily close (IRR)','TSETMC official daily market price (IRR)'].includes(raw.source)&&closureForQuote(asset,stamp,time);
    const carried=input.mode!=='baseline'&&historicalPricePolicy===LAST_KNOWN_POLICY&&tehranDay(time)<tehranDay(stamp);
    if(stamp-time>7*86400000&&!closure&&!carried)return null;
    return {price_rial:raw.price_rial,quoted_at:raw.quoted_at,source:raw.source,
      ...(closure?{pricing_basis:'last_open_before_confirmed_closure',closure_id:closure.id}:carried?{pricing_basis:'owner_authorized_last_known'}:{})};
  };
  for(const asset of [...assets,...Object.keys(extra)]){
    const q=Object.hasOwn(extra,asset)?extra[asset]:input.quantities[asset];
    if(q!==null&&(typeof q!=='number'||!Number.isFinite(q)||q<0))fail();
    if(!Object.hasOwn(extra,asset))quantities[asset]=q;
    const p=quote(input.quotes?.[asset],asset);if(p)quotes[asset]=p;
    if(q>0&&p?.pricing_basis==='owner_authorized_last_known')estimated.push(asset);
    if(q===null)missing.push(asset);else if(q===0)values[asset]=0;
    else if(!p)missing.push(asset);else{
      const value=q*p.price_rial;
      if(!Number.isFinite(value)||value<0)fail();values[asset]=value;
    }
  }
  const gold=quote(input.gold_quote);
  const dollar=quote(input.usd_quote);
  if(gold?.pricing_basis==='owner_authorized_last_known')estimated.push('gold_18k_denominator');
  if(dollar?.pricing_basis==='owner_authorized_last_known'&&input.minimum_usd===5)estimated.push('historical_usd_quote');
  let minimum=minimumRial;
  if(input.minimum_usd!==undefined){
    if(input.minimum_usd!==5||input.mode!=='historical')fail();
    if(!dollar)missing.push('historical_usd_quote');
    else minimum=Math.max(minimum,5*dollar.price_rial);
  }
  if(!Array.isArray(input.issues))fail();
  const issues=[...new Set(input.issues)];
  if(issues.length>100||issues.some(x=>typeof x!=='string'||x.length>150||/[<>&\n]/.test(x)))fail();
  const complete=!!gold&&!missing.length&&!issues.length;
  const visible=Object.fromEntries(Object.entries(values).filter(([,v])=>v>=minimum));
  const total=complete?Object.values(visible).reduce((a,b)=>a+b,0):null;
  const grams=complete?total/gold.price_rial:null;
  if(complete&&(!Number.isFinite(total)||total<0||!Number.isFinite(grams)))fail();
  const allocation=complete?Object.fromEntries([...new Set(Object.values(allGroups))].map(group=>[group,
    total>0?Object.entries(visible).filter(([a])=>allGroups[a]===group).reduce((s,[,v])=>s+v,0)/total*100:0])):null;
  return {week_ending:week,as_of:input.as_of,source_checked_at:input.source_checked_at,workbook_updated_at:input.workbook_updated_at,
    workbook_sha256:input.workbook_sha256,mode:input.mode,quantities,quotes,gold_quote:gold,issues,status:complete?'complete':'incomplete',
    missing_assets:missing,total_rial:total,gold_grams:grams,allocation,
    included_values:complete?visible:null,
    ...(historicalPricePolicy===LAST_KNOWN_POLICY&&input.mode!=='baseline'?{price_inputs_revision:priceInputsRevision,estimated_assets:estimated,valuation_basis:estimated.length?'estimated_last_known':'dated_prices'}:{}),
    ...(Object.keys(extra).length?{additional_quantities:extra}:{}),
    ...(input.minimum_usd===5?{minimum_usd:5,usd_quote:dollar,minimum_rial:dollar?minimum:null}:{})};
}

export function applyHistoryPriceFallbacks(weeks,priceInputs,options){
  if(options.historicalPricePolicy!==LAST_KNOWN_POLICY)return weeks;
  const catalog=new Map();
  const add=(asset,p,owner=false)=>{
    const stamp=Date.parse(p?.quoted_at);
    if(!Number.isFinite(stamp)||!Number.isFinite(p?.price_rial)||p.price_rial<=0||typeof p.source!=='string')return;
    if(!catalog.has(asset))catalog.set(asset,[]);catalog.get(asset).push({p,stamp,owner,day:tehranDay(stamp)});
  };
  for(const row of weeks){
    if(row.mode==='baseline')continue;
    for(const [a,p] of Object.entries(row.quotes||{}))add(a,p);
    add('gold_18k_denominator',row.gold_quote);add('historical_usd_quote',row.usd_quote);
  }
  for(const p of priceInputs||[])add(p.asset,p,true);
  for(const values of catalog.values())values.sort((a,b)=>a.day.localeCompare(b.day)||Number(a.owner)-Number(b.owner)||a.stamp-b.stamp);
  const latest=(asset,asof)=>(catalog.get(asset)||[]).findLast(p=>p.stamp<=asof)?.p;
  const repriced=weeks.map(row=>{
    if(row.mode==='baseline')return row;
    const stamp=Date.parse(row.as_of),quotes={...row.quotes};
    for(const asset of [...options.assets,...Object.keys(options.additionalGroups||{})]){
      const p=latest(asset,stamp);if(p)quotes[asset]=p;
    }
    const candidate=calculateGoldWeek({...row,quotes,gold_quote:latest('gold_18k_denominator',stamp)||row.gold_quote,
      ...(row.minimum_usd===5?{usd_quote:latest('historical_usd_quote',stamp)||row.usd_quote}:{})},options);
    return row.status==='complete'&&candidate.status!=='complete'?row:candidate;
  });
  return mergeGoldWeeks([],repriced,options);
}

export function mergeGoldWeeks(existing,incoming,options){
  const byWeek=new Map((existing||[]).map(row=>[row.week_ending,row]));
  for(const input of incoming){
    const record=calculateGoldWeek(input,options),previous=byWeek.get(record.week_ending);
    // A backfill must not erase verified observations or manually completed data.
    const refreshEstimate=previous?.mode==='historical'&&record.mode==='historical'&&record.status==='complete'&&
      (previous.valuation_basis==='estimated_last_known'||previous.price_inputs_revision!==record.price_inputs_revision);
    if(previous?.status==='complete'&&!refreshEstimate&&!(previous.mode==='baseline'&&record.mode==='live'))continue;
    if(previous&&previous.mode!=='historical'&&record.mode==='historical')continue;
    byWeek.set(record.week_ending,record);
  }
  return [...byWeek.values()].sort((a,b)=>a.week_ending.localeCompare(b.week_ending)).map((record,i,all)=>{
    const previous=all[i-1],adjacent=previous&&Date.parse(record.week_ending)-Date.parse(previous.week_ending)===7*86400000;
    const quantities={...record.quantities,...record.additional_quantities},prior={...previous?.quantities,...previous?.additional_quantities};
    const changes=previous&&Object.keys(quantities).every(a=>quantities[a]!==null&&typeof prior[a]==='number')?Object.keys(quantities).filter(a=>quantities[a]!==prior[a]).length:null;
    const change=adjacent&&record.status==='complete'&&previous.status==='complete'?record.gold_grams-previous.gold_grams:null;
    return {...record,quantity_change_count:changes,change_gold_grams:change,change_percent:change!==null&&previous.gold_grams>0?change/previous.gold_grams*100:null};
  });
}

export function goldHistorySvg(weeks,{formatTime,escape,number}={}){
  const W=1600,H=900,ink='#edf5ff',muted='#a9bed5',gold='#e8c56a';
  const valid=weeks.filter(w=>w.status==='complete'&&Number.isFinite(w.gold_grams));
  const text=(x,y,s,size=24,fill=ink,weight=400,anchor='end')=>`<text x="${x}" y="${y}" font-family="Estedad" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}">${escape(s)}</text>`;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="1600" height="900" rx="32" fill="#101e34"/>`;
  svg+=text(1510,85,'ارزش هفتگی پرتفوی بر حسب طلای ۱۸ عیار',36,ink,700);
  svg+=text(1510,135,'واحد: گرم طلای ۱۸ عیار',24,muted);
  if(weeks.some(w=>w.valuation_basis==='estimated_last_known'))svg+=text(1510,163,'برخی هفته‌ها با آخرین قیمت موجود برآورد شده‌اند.',18,muted);
  if(!valid.length)return svg+text(800,450,'هنوز دادهٔ کامل و تأییدشده‌ای برای رسم نمودار وجود ندارد.',29,ink,700,'middle')+'</svg>';
  const left=145,right=1500,top=210,bottom=720;
  const minimum=Math.min(...valid.map(w=>w.gold_grams)),maximum=Math.max(...valid.map(w=>w.gold_grams));
  const pad=Math.max((maximum-minimum)*.15,maximum*.03,1),lo=Math.max(0,minimum-pad),hi=maximum+pad;
  const x=i=>left+(right-left)*i/Math.max(1,weeks.length-1),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
  for(let i=0;i<=5;i++){
    const v=lo+(hi-lo)*i/5,yy=y(v);
    svg+=`<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" stroke="#263b54"/>`+text(left-15,yy+8,number(v),19,muted);
  }
  let path='',previous=null;
  weeks.forEach((week,i)=>{
    if(week.status!=='complete'){previous=null;return;}
    const adjacent=previous&&Date.parse(week.week_ending)-Date.parse(previous.week_ending)===7*86400000;
    path+=(adjacent?'L':'M')+x(i)+' '+y(week.gold_grams)+' ';previous=week;
  });
  svg+=`<path d="${path}" fill="none" stroke="${gold}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  weeks.forEach((w,i)=>{if(w.status==='complete')svg+=`<circle cx="${x(i)}" cy="${y(w.gold_grams)}" r="5" fill="${gold}"/>`;});
  for(const i of [...new Set([0,Math.floor((weeks.length-1)/2),weeks.length-1])]){
    if(weeks[i])svg+=text(x(i),775,formatTime(weeks[i].as_of).split(' • ')[0],17,muted,700,'middle');
  }
  const last=valid.at(-1);
  svg+=text(1510,193,'آخرین مشاهده: '+formatTime(last.as_of),19,muted,700);
  svg+=text(1500,845,(last.valuation_basis==='estimated_last_known'?'آخرین مقدار برآوردی: ':'آخرین مقدار: ')+number(last.gold_grams)+' گرم',25,gold,700);
  svg+=text(120,845,number(valid.length)+' ثبت کامل از '+number(weeks.length),21,muted,400,'start');
  return svg+'</svg>';
}
