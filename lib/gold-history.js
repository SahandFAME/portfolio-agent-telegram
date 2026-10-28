import marketClosures from './iran-market-closures.json' with {type:'json'};

export const HISTORY_CALENDAR='wednesday-v1';
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
export function calculateGoldWeek(input,{assets,groups,additionalGroups={},minimumRial=500000,now=Date.now()}={}){
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
  const quantities={},quotes={},values={},missing=[];
  const quote=(raw,asset)=>{
    if(!raw||!Number.isFinite(raw.price_rial)||raw.price_rial<=0||typeof raw.source!=='string'||!raw.source||raw.source.length>120)return null;
    const time=Date.parse(raw.quoted_at);
    if(!Number.isFinite(time)||time>stamp)return null;
    const closure=input.mode==='historical'&&['Shakhesban historical daily close (IRR)','TSETMC official daily market price (IRR)'].includes(raw.source)&&closureForQuote(asset,stamp,time);
    if(stamp-time>7*86400000&&!closure)return null;
    return {price_rial:raw.price_rial,quoted_at:raw.quoted_at,source:raw.source,
      ...(closure?{pricing_basis:'last_open_before_confirmed_closure',closure_id:closure.id}:{})};
  };
  for(const asset of [...assets,...Object.keys(extra)]){
    const q=Object.hasOwn(extra,asset)?extra[asset]:input.quantities[asset];
    if(q!==null&&(typeof q!=='number'||!Number.isFinite(q)||q<0))fail();
    if(!Object.hasOwn(extra,asset))quantities[asset]=q;
    const p=quote(input.quotes?.[asset],asset);if(p)quotes[asset]=p;
    if(q===null)missing.push(asset);else if(q===0)values[asset]=0;
    else if(!p)missing.push(asset);else{
      const value=q*p.price_rial;
      if(!Number.isFinite(value)||value<0)fail();values[asset]=value;
    }
  }
  const gold=quote(input.gold_quote);
  const dollar=quote(input.usd_quote);
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
    ...(Object.keys(extra).length?{additional_quantities:extra}:{}),
    ...(input.minimum_usd===5?{minimum_usd:5,usd_quote:dollar,minimum_rial:dollar?minimum:null}:{})};
}

export function mergeGoldWeeks(existing,incoming,options){
  const byWeek=new Map((existing||[]).map(row=>[row.week_ending,row]));
  for(const input of incoming){
    const record=calculateGoldWeek(input,options),previous=byWeek.get(record.week_ending);
    // A backfill must not erase verified observations or manually completed data.
    if(previous?.status==='complete'&&!(previous.mode==='baseline'&&record.mode==='live'))continue;
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
  svg+=text(1510,180,'آخرین مشاهدهٔ تأییدشده: '+formatTime(last.as_of),19,muted,700);
  svg+=text(1500,845,'آخرین مقدار تأییدشده: '+number(last.gold_grams)+' گرم',25,gold,700);
  svg+=text(120,845,number(valid.length)+' ثبت کامل از '+number(weeks.length),21,muted,400,'start');
  return svg+'</svg>';
}
