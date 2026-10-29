"""Read-only historical reconstruction and new, separate Excel history export.

The source XLSM is never saved. Unreconciled/undated trades are not guessed.
No holdings, quotes, tokens or raw service responses are printed.
"""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO
from html.parser import HTMLParser
from pathlib import Path
import base64
import hashlib
import json
import math
import os
import re
from urllib.parse import quote,urlsplit,unquote
from urllib import request
from zoneinfo import ZoneInfo

import jdatetime
from openpyxl import Workbook,load_workbook
from openpyxl.chart import LineChart,Reference
from openpyxl.styles import Alignment,Font,PatternFill
from openpyxl.utils.cell import range_boundaries
from verify_onedrive import (MAPPING,SyncError,download_workbook,extract_quantities,graph_token,
                             http,json_request,required,utcnow)

TEHRAN=ZoneInfo('Asia/Tehran')
ENDPOINT='https://portfolio-agent-telegram.vercel.app/api/telegram'
DIGITS=str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789')
CRYPTO={'BTC':'bitcoin','ETH':'ethereum','Tether':'tether','Link':'chainlink','ADA':'cardano','SOL':'solana','ONDO':'ondo-finance','XAUT':'tether-gold'}
ADDITIONAL_TABLES={
    'XAUT':{'table':'Table1312131921202226','sheet':'Crypto Investing Portfolio','label':'XAUT'},
    'اهرم':{'table':'Table51336','sheet':'پتفوی بورسی','label':'اهرم'},
}
DAY_FIRST_ASSETS=frozenset({'BTC','Link','Tether','ADA'})  # ADA: owner's 2026-10-28 Excel evidence.
DUST_TOTAL_ASSETS=frozenset({'ADA','SOL','ONDO','Link'})  # Owner-confirmed small-balance totals.
MATIC_WAIVED_REMAINDER_SIGNATURE='16c88b27aacb62e7b845677132ff4d3137527101d572c3a3d0437a5c6fd735e4'
PREWINDOW_TETHER_SIGNATURE='3a187613376cf0faa691753a09296c65d859d7d91ddbd3b3999fa7293aa7f1df'
HISTORY_CALENDAR='wednesday-v1'
LAST_KNOWN_POLICY='last-known-before-valuation-v1'
MARKET_CLOSURES=json.loads((Path(__file__).resolve().parents[1]/'lib'/'iran-market-closures.json').read_text())['closures']
LISTED_QUOTE_SOURCES=frozenset({'Shakhesban historical daily close (IRR)','TSETMC official daily market price (IRR)'})


class HistoricalEvents(list):
    """An opening adjustment is a period boundary, not an invented trade date."""
    opening_adjustment=0.0


class HistoricalExtras(list):
    def __init__(self,required=()):
        super().__init__()
        self.holdings={a:{'events':[],'current':None,'issues':['historical_table_missing']} for a in required}


def additional_holding(sheet,formulas,table,qi,top,bottom,events,ambiguous):
    """Validate audited table identity and current subtotal before reconstructing."""
    left,_,_,_=range_boundaries(table.ref)
    asset=next((a for a,s in ADDITIONAL_TABLES.items() if s['table']==table.name and s['sheet']==sheet.title
        and top>1 and norm(str(sheet.cell(top-1,left).value or '')).lower()==norm(s['label']).lower()),None)
    if asset is None:return None
    column='Quantity' if asset=='XAUT' else 'حجم خرید'
    formula=re.sub(r'\s+','',str(formulas.cell(bottom,qi).value or ''))
    expected='=SUBTOTAL(109,'+table.name+'['+column+'])'
    balance=sheet.cell(bottom,qi).value
    issues=['invalid_historical_transactions'] if ambiguous else []
    valid=table.totalsRowCount==1 and formula.lower()==re.sub(r'\s+','',expected).lower() and isinstance(balance,(int,float)) and not isinstance(balance,bool) and math.isfinite(balance) and balance>=0 and not any(sheet.row_dimensions[r].hidden for r in range(top+1,bottom))
    if not valid or not math.isclose(sum(q for _,q in events),balance,abs_tol=1e-8,rel_tol=1e-10):
        issues.append('quantity_reconciliation_failed');balance=None
    if negative_historical_balance(events,balance or 0):issues.append('negative_reconstructed_balance')
    return asset,{'events':events,'current':balance,'issues':issues}


def deduction_signature(capital,fee,ignored):
    return hashlib.sha256(json.dumps([format(v,'.15g') for v in [capital,fee,ignored]],separators=(',',':')).encode()).hexdigest()


def parse_trade_date(value,*,day_first=False):
    if isinstance(value,datetime):return value.date()
    if isinstance(value,date):return value
    raw=str(value or '').translate(DIGITS).strip()
    parts=re.fullmatch(r'(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})',raw)
    if not parts:raise ValueError('undated_or_compound_trade')
    a,b,c=map(int,parts.groups())
    if a>=1700:return date(a,b,c)
    if 1300<=a<=1599:return jdatetime.date(a,b,c).togregorian()
    if day_first:
        if c>=1700:return date(c,b,a)
        if 1300<=c<=1599:return jdatetime.date(c,b,a).togregorian()
    # Year-last strings are accepted only when month/day order is unambiguous.
    if c>=1700 and a>12 and b<=12:return date(c,b,a)
    if c>=1700 and b>12 and a<=12:return date(c,a,b)
    raise ValueError('ambiguous_trade_date')


def tether_total_accounting(values,formulas,table,quantity_column,date_column,top,bottom):
    """Recognize the owner-confirmed formula shape, never evaluate Excel code."""
    cell=formulas.cell(bottom,quantity_column)
    formula=re.sub(r'\s+','',str(cell.value or '')).replace('$','')
    first=top+1;reference=values.cell(first,quantity_column).coordinate
    pattern=r'=SUBTOTAL\(109,'+re.escape(table.name)+r'\[Quantity\]\)-'+re.escape(reference)+r'-(\d+(?:\.\d+)?)'
    match=re.fullmatch(pattern,formula,re.I)
    comment=cell.comment.text if cell.comment else ''
    if not match or norm('My Trading Capital').lower() not in norm(comment).lower():return None
    fee=float(match[1]);annotation=re.search(r'~?\s*(\d+(?:\.\d+)?)\s*\$',comment)
    capital=values.cell(first,quantity_column).value
    if not annotation or not math.isclose(float(annotation[1]),fee,abs_tol=1e-10) or not math.isfinite(fee):return None
    if isinstance(capital,bool) or not isinstance(capital,(int,float)) or not math.isfinite(capital) or capital<0:return None
    try:opening_date=parse_trade_date(values.cell(first,date_column).value,day_first=True)
    except (ValueError,TypeError,OverflowError):return None
    if opening_date>=date(2025,10,25):return None
    if any(values.row_dimensions[row].hidden for row in range(first,bottom)):return None
    return {'capital_row':first,'capital_quantity':capital,'fee_quantity':fee,'total_cell':cell.coordinate}


def negative_historical_balance(events,current,*,start=None):
    daily=defaultdict(float)
    for day,quantity in events:daily[day]+=quantity
    balance=sum(q for d,q in daily.items() if start is not None and d<start)+getattr(events,'opening_adjustment',0.0)
    tolerance=max(1e-8,abs(current)*1e-10)
    if balance < -tolerance:return True
    for day in sorted(daily):
        if start is not None and day<start:continue
        balance+=daily[day]
        if balance < -tolerance:return True
    return False


def owner_waived_matic_remainder(sheet,formulas,table,qi,top,bottom,events,ambiguous,balance):
    """Owner's immateriality waiver, not an invented fee or historical quote."""
    if sheet.title!='Crypto Investing Portfolio' or table.name!='Table1312131921' or top<=1:return False
    left,_,_,_=range_boundaries(table.ref)
    if norm(str(sheet.cell(top-1,left).value or '')).lower()!='matic':return False
    if table.totalsRowCount!=1 or isinstance(balance,bool) or balance!=0 or ambiguous or not events or max(d for d,_ in events)>=date(2025,10,25):return False
    if any(sheet.row_dimensions[r].hidden for r in range(top+1,bottom)) or negative_historical_balance(events,0):return False
    formula=re.sub(r'\s+','',str(formulas.cell(bottom,qi).value or ''))
    match=re.fullmatch(r'=SUBTOTAL\(109,'+re.escape(table.name)+r'\[Quantity\]\)-(\d+(?:\.\d+)?)',formula,re.I)
    if not match:return False
    remainder=float(match[1])
    return math.isfinite(remainder) and remainder>0 and math.isclose(sum(q for _,q in events),remainder,abs_tol=1e-8,rel_tol=1e-10) and hashlib.sha256(format(remainder,'.15g').encode()).hexdigest()==MATIC_WAIVED_REMAINDER_SIGNATURE


def reconstruct(content,config):
    current=extract_quantities(content)
    book=load_workbook(BytesIO(content),data_only=True,keep_links=False)
    formulas=load_workbook(BytesIO(content),data_only=False,keep_links=False)
    try:
        tables={t.name:(s,t) for s in book for t in s.tables.values()}
        trades={};problems={};extras=HistoricalExtras(config.get('additional_assets',[]))
        for asset,spec in MAPPING.items():
            sheet,table=tables[spec['table']];left,top,right,bottom=range_boundaries(table.ref)
            headers=[c.name for c in table.tableColumns];qi=left+headers.index(spec['column'])
            di=left+headers.index('Date' if 'Date' in headers else 'تاریخ')
            accounting=tether_total_accounting(sheet,formulas[sheet.title],table,qi,di,top,bottom) if asset=='Tether' else None
            events=[];issues=[];net=0.0;ignored_net=0.0
            for row in range(top+1,bottom):
                # Owner-authorized exclusion, scoped to this exact Tether label.
                # Reconcile the remaining signed quantities to the untouched total.
                if asset=='Tether' and norm(str(sheet.cell(row,di).value or ''))==norm('هزینه گم شده'):
                    ignored=sheet.cell(row,qi).value
                    if isinstance(ignored,(int,float)) and not isinstance(ignored,bool) and math.isfinite(ignored):ignored_net+=ignored
                    elif ignored is not None:issues.append('invalid_transaction_quantity@'+spec['table']+'#'+str(row))
                    continue
                if accounting and row==accounting['capital_row']:continue
                quantity=sheet.cell(row,qi).value
                if quantity is None:continue
                if isinstance(quantity,bool) or not isinstance(quantity,(int,float)) or not math.isfinite(quantity):
                    issues.append('invalid_transaction_quantity@'+spec['table']+'#'+str(row));continue
                net+=quantity
                if quantity==0:continue
                try:events.append((parse_trade_date(sheet.cell(row,di).value,day_first=asset in DAY_FIRST_ASSETS),float(quantity)))
                except (ValueError,TypeError,OverflowError):issues.append('ambiguous_transaction_date@'+spec['table']+'#'+str(row))
            expected=net
            if accounting:
                expected+=ignored_net-accounting['fee_quantity']
                confirmed=deduction_signature(accounting['capital_quantity'],accounting['fee_quantity'],ignored_net)==PREWINDOW_TETHER_SIGNATURE
                if confirmed:
                    events=HistoricalEvents(events)
                    events.opening_adjustment=ignored_net-accounting['fee_quantity']
                else:
                    if accounting['fee_quantity']:issues.append('undated_tether_fee@'+accounting['total_cell']+'#quantity='+format(-accounting['fee_quantity'],'.15g'))
                    if ignored_net:issues.append('undated_ignored_tether_adjustment@'+spec['table']+'#quantity='+format(ignored_net,'.15g'))
            if not math.isclose(expected,current[asset],rel_tol=1e-10,abs_tol=1e-8):
                detail='@'+spec['table']+'#current_minus_expected_net='+format(current[asset]-expected,'.15g') if asset=='Tether' else ''
                issues.append('quantity_reconciliation_failed'+detail)
                if asset in CRYPTO:
                    if not isinstance(events,HistoricalEvents):events=HistoricalEvents(events)
                    events.reconciliation_delta=current[asset]-expected
            # The reserved-capital basis applies to the requested analysis year.
            # Validate its opening balance and every subsequent daily balance.
            start=date(2025,10,25) if accounting else None
            if negative_historical_balance(events,current[asset],start=start):issues.append('negative_reconstructed_balance')
            trades[asset]=events;problems[asset]=sorted(set(issues))
        for name,(sheet,table) in tables.items():
            if name in {v['table'] for v in MAPPING.values()}:continue
            columns=[c.name for c in table.tableColumns]
            if any(c in columns for c in ('Quantity','حجم خرید')) and any(c in columns for c in ('Date','تاریخ')):
                left,top,right,bottom=range_boundaries(table.ref)
                qi=left+columns.index('Quantity' if 'Quantity' in columns else 'حجم خرید')
                di=left+columns.index('Date' if 'Date' in columns else 'تاریخ')
                events=[];ambiguous=False
                for r in range(top+1,bottom):
                    amount=sheet.cell(r,qi).value
                    if amount is None or amount==0:continue
                    if isinstance(amount,bool) or not isinstance(amount,(int,float)) or not math.isfinite(amount):ambiguous=True;continue
                    # The owner confirmed day/month/year in Trading Journal.
                    # Scope this additional year-last interpretation to MATIC.
                    try:events.append((parse_trade_date(sheet.cell(r,di).value,day_first=name in {'Table1312131921',*(s['table'] for s in ADDITIONAL_TABLES.values())}),float(amount)))
                    except (ValueError,TypeError):ambiguous=True
                holding=additional_holding(sheet,formulas[sheet.title],table,qi,top,bottom,events,ambiguous)
                if holding:
                    asset,record=holding;extras.holdings[asset]=record
                    continue
                balance=sheet.cell(bottom,qi).value
                closed_before_window=table.totalsRowCount==1 and balance==0 and not ambiguous and events and max(d for d,_ in events)<date(2025,10,25) and math.isclose(sum(q for _,q in events),0,abs_tol=1e-8)
                waived=owner_waived_matic_remainder(sheet,formulas[sheet.title],table,qi,top,bottom,events,ambiguous,balance)
                if (events or ambiguous) and not closed_before_window and not waived:
                    extras.append(sheet.title+' / '+name)
        return current,trades,problems,extras
    finally:book.close();formulas.close()


def week_dates():
    # The initial owner-confirmed year is immutable. Future records are live
    # observations; a later manual-quantity edit must not rewrite this baseline.
    end=date(2026,10,21)
    return [end-timedelta(weeks=i) for i in reversed(range(52))]


def quantities_at(day,trades,problems,manual):
    result={}
    for asset,events in trades.items():
        opening=getattr(events,'opening_adjustment',0.0) if day>=date(2025,10,25) else 0.0
        result[asset]=None if problems[asset] else max(0.0,sum(q for d,q in events if d<=day)+opening)
    result.update(manual)
    return result


def api(query,body=None):
    return json_request(ENDPOINT+query,method='POST' if body is not None else 'GET',
        headers={'x-portfolio-sync-secret':required('PORTFOLIO_SYNC_SECRET_AGENT'),'Content-Type':'application/json'},
        body=json.dumps(body,allow_nan=False).encode() if body is not None else None,retries=0,redirect=False)


def norm(text):return re.sub(r'[\s\u200c\u200d]','',text.translate(str.maketrans('كيى','کیی')))


def market_json(url):
    if urlsplit(url).scheme!='https' or urlsplit(url).hostname not in {'api.tgju.org','cdn.tsetmc.com','api.coingecko.com'}:
        raise SyncError('unapproved_history_provider')
    class NoRedirect(request.HTTPRedirectHandler):
        def redirect_request(self,*args):return None
    try:
        opener=request.build_opener(NoRedirect)
        with opener.open(request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=8) as response:
            content=response.read(5*1024*1024+1)
        if len(content)>5*1024*1024:raise ValueError()
        data=json.loads(content)
        if not isinstance(data,dict):raise ValueError()
        return data
    except Exception:raise SyncError('historical_provider_unavailable') from None


def tgju_history(slug):
    url='https://api.tgju.org/v1/market/indicator/summary-table-data/'+quote(slug,safe='')
    first=market_json(url+'?lang=fa&start=0&length=1&order_dir=asc')
    count=first.get('recordsTotal')
    if not isinstance(count,int) or count<0:raise SyncError('historical_price_schema')
    data=market_json(url+f'?lang=fa&start={max(0,count-650)}&length=650&order_dir=asc')
    result=[]
    for row in data.get('data',[]):
        if not isinstance(row,list) or len(row)<8:raise SyncError('historical_price_schema')
        day=datetime.strptime(row[6],'%Y/%m/%d').date()
        value=float(str(row[3]).translate(DIGITS).replace(',',''))
        if math.isfinite(value) and value>0:result.append((datetime.combine(day,time.max,TEHRAN),value))
    return sorted(result)


class PriceSeries(list):
    def __init__(self,rows,source):super().__init__(rows);self.source=source


def market_text(url):
    parts=urlsplit(url)
    if parts.scheme!='https' or parts.hostname!='www.shakhesban.com' or parts.username or parts.password:raise SyncError('unapproved_history_provider')
    class NoRedirect(request.HTTPRedirectHandler):
        def redirect_request(self,*args):return None
    try:
        with request.build_opener(NoRedirect).open(request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=8) as response:
            content=response.read(5*1024*1024+1)
        if len(content)>5*1024*1024:raise ValueError()
        return content.decode('utf-8')
    except Exception:raise SyncError('historical_provider_unavailable') from None


class ArchiveScripts(HTMLParser):
    def __init__(self):super().__init__();self.active=None;self.parts=[];self.scripts=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script':self.active=dict(attrs).get('type','');self.parts=[]
    def handle_data(self,data):
        if self.active is not None:self.parts.append(data)
    def handle_endtag(self,tag):
        if tag=='script' and self.active is not None:
            self.scripts.append((self.active,''.join(self.parts)));self.active=None


def parse_shakhesban_history(html,asset):
    symbol={'فلز فارابی':'فلزفارابی'}.get(asset,asset)
    kind='stock' if asset in {'فملی','سجام'} else 'fund'
    parser=ArchiveScripts();parser.feed(html);identities=[];chunks=[]
    for content_type,body in parser.scripts:
        if content_type=='application/ld+json':
            try:metadata=json.loads(body)
            except ValueError:continue
            if isinstance(metadata,dict) and metadata.get('@type')=='Corporation':identities.append(metadata)
        for match in re.finditer(r'self\.__next_f\.push\((.*?)\)\s*;?\s*$',body,re.S):
            try:
                data=json.loads(match[1])
                if isinstance(data,list) and len(data)==2 and data[0]==1 and isinstance(data[1],str):chunks.append(data[1])
            except ValueError:continue
    expected='/markets/'+kind+'/'+symbol
    if len(identities)!=1 or norm(str(identities[0].get('tickerSymbol','')))!=norm(symbol):raise SyncError('historical_instrument_unverified')
    identity=urlsplit(str(identities[0].get('url','')))
    if identity.scheme!='https' or identity.hostname!='www.shakhesban.com' or identity.username or identity.password or unquote(identity.path).rstrip('/')!=expected:raise SyncError('historical_instrument_unverified')
    stream=''.join(chunks);candidates=[]
    for match in re.finditer(r'"rows"\s*:\s*\[',stream):
        try:rows,_=json.JSONDecoder().raw_decode(stream[match.end()-1:])
        except ValueError:continue
        if isinstance(rows,list) and rows and all(isinstance(r,dict) and 'trade_date' in r and 'close_price' in r for r in rows):candidates.append(rows)
    if len(candidates)!=1 or len(candidates[0])>20000:raise SyncError('historical_price_schema')
    byday={}
    for row in candidates[0]:
        raw=row['trade_date'];value=row['close_price']
        if not isinstance(raw,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',raw):raise SyncError('historical_price_schema')
        try:day=date.fromisoformat(raw)
        except ValueError:raise SyncError('historical_price_schema') from None
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<=0:continue
        if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<=0 for v in [row.get('volume'),row.get('trade_count')]):continue
        if day in byday and byday[day]!=value:raise SyncError('historical_price_conflict')
        byday[day]=float(value)
    if not byday:raise SyncError('historical_price_schema')
    return PriceSeries([(datetime.combine(d,time.max,TEHRAN),p) for d,p in sorted(byday.items())],'Shakhesban historical daily close (IRR)')


def listed_history(asset):
    symbol={'فلز فارابی':'فلزفارابی'}.get(asset,asset)
    kind='stock' if asset in {'فملی','سجام'} else 'fund'
    try:return parse_shakhesban_history(market_text('https://www.shakhesban.com/markets/'+kind+'/'+quote(symbol,safe='')+'/history'),asset)
    except Exception:pass
    return tsetmc_history(asset)


def tsetmc_history(asset):
    data=market_json('https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/'+quote(asset,safe=''))
    matches=[r for r in data.get('instrumentSearch',[]) if norm(str(r.get('lVal18AFC','')))==norm(asset)]
    codes={str(r.get('insCode')) for r in matches if r.get('insCode')}
    if len(codes)!=1:raise SyncError('historical_instrument_unverified')
    data=market_json('https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDailyList/'+next(iter(codes))+'/0')
    result=[]
    for row in data.get('closingPriceDaily',[]):
        day=datetime.strptime(str(row['dEven']),'%Y%m%d').date()
        value=row.get('pDrCotVal') or row.get('pClosing')
        if isinstance(value,(float,int)) and math.isfinite(value) and value>0:result.append((datetime.combine(day,time.max,TEHRAN),float(value)))
    return PriceSeries(sorted(result),'TSETMC official daily market price (IRR)')


def crypto_history(asset):
    data=market_json('https://api.coingecko.com/api/v3/coins/'+CRYPTO[asset]+'/market_chart?vs_currency=usd&days=365')
    return [(datetime.fromtimestamp(row[0]/1000,timezone.utc),float(row[1])) for row in data.get('prices',[]) if len(row)==2 and row[1]>0]


def closure_for_quote(asset,asof,stamp):
    day=asof.astimezone(TEHRAN).date().isoformat();price_day=stamp.astimezone(TEHRAN).date().isoformat()
    return next((c for c in MARKET_CLOSURES if asset in c['assets'] and c['start']<=day<=c['end'] and price_day==c['last_open']),None)


def last_quote(series,asof,source,asset=None,allow_last_known=False):
    before=[row for row in series if row[0]<=asof
        and isinstance(row[1],(int,float)) and not isinstance(row[1],bool) and math.isfinite(row[1]) and row[1]>0]
    if not before:return None
    stamp,value=max(before,key=lambda row:row[0])
    closure=closure_for_quote(asset,asof,stamp) if source in LISTED_QUOTE_SOURCES else None
    if asof-stamp>timedelta(days=7) and not closure and not allow_last_known:return None
    carried=allow_last_known and stamp.astimezone(TEHRAN).date()<asof.astimezone(TEHRAN).date()
    return {'price_rial':value,'quoted_at':stamp.astimezone(timezone.utc).isoformat(),'source':source,
        **({'pricing_basis':'last_open_before_confirmed_closure','closure_id':closure['id']} if closure else {'pricing_basis':'owner_authorized_last_known'} if carried else {})}


def select_history_quote(asset,asof,fresh,existing,allow_last_known=False):
    """Select dated IRR/unit evidence; never use a quote after the valuation."""
    candidates=[]
    def add(raw,owner=False):
        if not isinstance(raw,dict):return
        try:
            stamp=datetime.fromisoformat(raw['quoted_at'].replace('Z','+00:00'))
            result=last_quote([(stamp,raw['price_rial'])],asof,raw['source'],asset,allow_last_known)
            if result:candidates.append((stamp.astimezone(TEHRAN).date(),owner,stamp,result))
        except (KeyError,TypeError,ValueError):return
    for row in existing.get('weeks',[]):
        if row.get('mode')!='historical':continue
        add(row.get('gold_quote') if asset=='gold' else row.get('usd_quote') if asset=='usd_cutoff' else row.get('quotes',{}).get(asset))
    add(fresh)
    for raw in existing.get('price_inputs',[]):
        if raw.get('asset')==asset:add(raw,True)
    return max(enumerate(candidates),key=lambda p:(*p[1][:3],p[0]))[1][3] if candidates else None


def saved_crypto_series(existing,asset):
    """Recover dated USD evidence only from verified historical conversions."""
    result=[]
    for row in existing.get('weeks',[]):
        if row.get('mode')!='historical':continue
        p=row.get('quotes',{}).get(asset);fx=row.get('usd_quote')
        if not p or not fx or p.get('source')!='CoinGecko USD × TGJU USD/IRR' or fx.get('source')!='TGJU USD/IRR daily close':continue
        if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<=0 for v in [p.get('price_rial'),fx.get('price_rial')]):continue
        try:
            asof=datetime.fromisoformat(row['as_of'].replace('Z','+00:00'))
            stamp=datetime.fromisoformat(p['quoted_at'].replace('Z','+00:00'))
            fxstamp=datetime.fromisoformat(fx['quoted_at'].replace('Z','+00:00'))
            price=p['price_rial']/fx['price_rial']
            limit=float('inf') if existing.get('historical_price_policy')==LAST_KNOWN_POLICY else 7*86400
            if not math.isfinite(price) or price<=0 or not 0<= (asof-stamp).total_seconds()<=limit or not 0<= (asof-fxstamp).total_seconds()<=limit:continue
            result.append((stamp,price))
        except (ValueError,TypeError,KeyError,ZeroDivisionError,OverflowError):continue
    return result


def saved_listed_quote(row,asset,asof):
    if not row or row.get('mode')!='historical':return None
    raw=row.get('quotes',{}).get(asset)
    if not raw or raw.get('source') not in LISTED_QUOTE_SOURCES:return None
    try:return last_quote([(datetime.fromisoformat(raw['quoted_at'].replace('Z','+00:00')),raw['price_rial'])],asof,raw['source'],asset)
    except (KeyError,TypeError,ValueError):return None


def historical_weeks(content,modified,checked,config,existing):
    current,trades,problems,extras=reconstruct(content,config)
    manual=existing.get('manual_baseline') or config['manual']
    allow_last_known=existing.get('historical_price_policy')==LAST_KNOWN_POLICY
    dates=week_dates();series={};source={}
    previous=[r for r in existing.get('weeks',[]) if r.get('mode')=='historical']
    definitions={'gold':'geram18','دلار':'price_dollar_rl','سکه تمام':'sekee','ربع سکه بانکی':'rob'}
    for asset,slug in definitions.items():
        try:series[asset]=tgju_history(slug);source[asset]='TGJU daily close (IRR)'
        except Exception:series[asset]=[]
    def fetch_asset(asset):
        try:
            if asset in CRYPTO:
                saved=saved_crypto_series(existing,asset)
                try:fresh=crypto_history(asset)
                except Exception:fresh=[]
                # Equal timestamps prefer the freshly fetched provider value.
                return asset,sorted(dict(saved+fresh).items()),'CoinGecko USD × TGJU USD/IRR'
            if asset!='شمش نقره 999':
                values=listed_history(asset)
                return asset,values,getattr(values,'source','TSETMC official daily market price (IRR)')
            # Silver must match the actual certificate. Never substitute spot silver.
        except Exception:pass
        return asset,[],'Historical quote unavailable'
    # These dust totals were confirmed by the owner. Other unresolved
    # balances still need their own source review before accepting a residual.
    candidates={a for a in DUST_TOTAL_ASSETS if problems[a]==['quantity_reconciliation_failed'] and hasattr(trades[a],'reconciliation_delta')}
    targets=[asset for asset in MAPPING if asset!='بلک راک' and (not problems[asset] or asset in candidates)]
    targets.extend(a for a,r in extras.holdings.items() if not r['issues'] and any(q for _,q in r['events']))
    with ThreadPoolExecutor(max_workers=3) as pool:
        for asset,values,label in pool.map(fetch_asset,targets):series[asset]=values;source[asset]=label
    rows=[];digest=hashlib.sha256(content).hexdigest()
    for day in dates:
        asof=datetime.combine(day,time.max,TEHRAN)
        quantities=quantities_at(day,trades,problems,manual)
        additional={a:None if r['issues'] else max(0,sum(q for d,q in r['events'] if d<=day)) for a,r in extras.holdings.items()}
        week_problems={a:list(codes) for a,codes in problems.items()}
        # The owner accepts sub-$5 discrepancies, not missing/ambiguous trades.
        # Prove the bound independently for each week using a dated USD quote.
        for asset in candidates:
            usd=last_quote(series.get(asset,[]),asof,source[asset])
            if usd and abs(trades[asset].reconciliation_delta)*usd['price_rial']<5:
                quantities[asset]=max(0.0,sum(q for d,q in trades[asset] if d<=day)+getattr(trades[asset],'opening_adjustment',0.0))
                week_problems[asset]=[]
        quotes={};gold=last_quote(series.get('gold',[]),asof,'TGJU 18K gram daily close (IRR)',allow_last_known=allow_last_known)
        gold=select_history_quote('gold',asof,gold,existing,allow_last_known)
        fx=last_quote(series.get('دلار',[]),asof,'TGJU USD/IRR daily close',allow_last_known=allow_last_known)
        fx=select_history_quote('usd_cutoff',asof,fx,existing,allow_last_known)
        for asset,q in {**quantities,**additional}.items():
            if q is None or q==0:continue
            if asset in ('آبشده (طلب)','آبشده (شمش زربد)'):p=gold
            elif asset=='ربع سکه غیره':p={**gold,'price_rial':gold['price_rial']*2.03325,'source':'TGJU 18K gram × 2.03325'} if gold else None
            else:p=last_quote(series.get(asset,[]),asof,source.get(asset,'Historical quote'),asset,allow_last_known)
            if asset in CRYPTO:
                p={**p,'price_rial':p['price_rial']*fx['price_rial']} if p and fx else None
            elif not p and (asset in MAPPING or asset=='اهرم') and asset not in {'بلک راک','شمش نقره 999'}:
                saved=[p for r in previous if (p:=saved_listed_quote(r,asset,asof))]
                p=max(saved,key=lambda p:p['quoted_at']) if saved else None
            p=select_history_quote(asset,asof,p,existing,allow_last_known)
            if p:quotes[asset]=p
        issues=['unmapped_historical_trade_table:'+re.sub(r'[<>&\n]','',name) for name in extras]
        issues.extend(code+':'+asset for asset,codes in week_problems.items() for code in codes)
        issues.extend(code+':'+asset for asset,r in extras.holdings.items() for code in r['issues'])
        rows.append({'week_ending':day.isoformat(),'as_of':asof.astimezone(timezone.utc).isoformat(),'source_checked_at':checked,
            'workbook_updated_at':modified,'workbook_sha256':digest,'mode':'historical','quantities':quantities,'quotes':quotes,'gold_quote':gold,'issues':issues,
            'minimum_usd':5,'usd_quote':fx,'additional_quantities':additional})
    return rows,{'unmapped_trade_tables':len(extras),'unreconciled_assets':sum(bool(p) for p in problems.values()),
        'dust_candidate_assets':len(candidates),'dust_accepted_asset_weeks':sum(r['quantities'][a] is not None for r in rows for a in candidates)}


def fa_time(stamp):
    value=datetime.fromisoformat(stamp.replace('Z','+00:00')).astimezone(TEHRAN)
    return jdatetime.datetime.fromgregorian(datetime=value).strftime('%Y/%m/%d %H:%M').translate(str.maketrans('0123456789','۰۱۲۳۴۵۶۷۸۹'))


def safe_text(value):
    value=str(value)
    return "'"+value if value.startswith(('=','+','-','@')) else value


def export_excel(history,groups):
    book=Workbook();summary=book.active;summary.title='ارزش هفتگی'
    book.properties.identifier='portfolio-agent:18k-gold-history:v1'
    summary.append(['هفته منتهی به','طلای ۱۸ عیار (گرم)','تغییر هفتگی (گرم)','تغییر هفتگی (درصد)','ارزش (تومان)','قیمت هر گرم (تومان)','وضعیت','تغییر تعداد دارایی‌ها','زمان مشاهده (تهران)','زمان بررسی منبع (تهران)'])
    holdings=book.create_sheet('دارایی‌ها');holdings.append(['هفته','دارایی','گروه','تعداد','قیمت واحد (ریال)','ارزش دارایی (تومان)','منبع قیمت','زمان قیمت (تهران)','مبنای قیمت','شناسه تعطیلی بازار'])
    allocations=book.create_sheet('ترکیب دارایی');allocations.append(['هفته','گروه','درصد'])
    exceptions=book.create_sheet('موارد نیازمند بررسی');exceptions.append(['هفته','نوع مسئله','دارایی'])
    for row in history['weeks']:
        label_day=datetime.fromisoformat(row['as_of'].replace('Z','+00:00')).astimezone(TEHRAN).date() if row['mode']=='baseline' else date.fromisoformat(row['week_ending'])
        week=jdatetime.date.fromgregorian(date=label_day).strftime('%Y/%m/%d').translate(str.maketrans('0123456789','۰۱۲۳۴۵۶۷۸۹'))
        gold=row.get('gold_quote')
        summary.append([week,row.get('gold_grams'),row.get('change_gold_grams'),row.get('change_percent'),
            math.floor(row['total_rial']/10+.5) if row.get('total_rial') is not None else None,math.floor(gold['price_rial']/10+.5) if gold else None,
            ('موقت • کامل' if row['status']=='complete' else 'موقت • ناقص') if row['mode']=='baseline' else ('برآورد با آخرین قیمت موجود' if row.get('valuation_basis')=='estimated_last_known' else 'کامل') if row['status']=='complete' else 'ناقص',row.get('quantity_change_count'),fa_time(row['as_of']),fa_time(row['source_checked_at'])])
        for asset,qty in {**row['quantities'],**row.get('additional_quantities',{})}.items():
            p=row.get('quotes',{}).get(asset)
            if qty==0 or isinstance(qty,(int,float)) and p and qty*p['price_rial']<(row.get('minimum_rial') or 500000):continue
            value=row.get('included_values',{});value=value.get(asset) if isinstance(value,dict) else None
            if value is None and isinstance(qty,(int,float)) and p:value=qty*p['price_rial']
            holdings.append([week,safe_text(asset),safe_text(groups.get(asset,'')),qty,p['price_rial'] if p else None,math.floor(value/10+.5) if value is not None else None,
                safe_text(p['source']) if p else None,fa_time(p['quoted_at']) if p else None,
                ('آخرین قیمت پایانی پیش از تعطیلی تأییدشده بازار' if p.get('pricing_basis')=='last_open_before_confirmed_closure' else 'برآورد با آخرین قیمت موجود؛ به درخواست مالک' if p.get('pricing_basis')=='owner_authorized_last_known' else 'قیمت تاریخی اعلام‌شده توسط مالک' if p.get('source')=='Owner supplied dated historical unit price' else None) if p else None,
                safe_text(p['closure_id']) if p and p.get('closure_id') else None])
        for group,pct in (row.get('allocation') or {}).items():allocations.append([week,safe_text(group),pct])
        for issue in row.get('issues',[]):
            kind,_,asset=issue.partition(':')
            label,_,location=kind.partition('@')
            labels={'ambiguous_transaction_date':'تاریخ تراکنش نامشخص یا چندپهلو','invalid_transaction_quantity':'تعداد تراکنش معتبر نیست',
                'quantity_reconciliation_failed':'جمع تغییرات تعداد با ماندهٔ تأییدشده تطبیق ندارد','negative_reconstructed_balance':'ماندهٔ تاریخی منفی می‌شود',
                'undated_tether_fee':'زمان هزینهٔ درج‌شده در فرمول مانده مشخص نیست',
                'undated_ignored_tether_adjustment':'زمان اثر هزینهٔ نادیده‌گرفته‌شده بر مانده مشخص نیست',
                'unmapped_historical_trade_table':'جدول معاملاتی خارج از نگاشت فعلی نیاز به بررسی دارد',
                'historical_table_missing':'جدول دارایی در منبع پیدا نشد',
                'invalid_historical_transactions':'تعداد یا تاریخ تراکنش تاریخی معتبر نیست'}
            description=labels.get(label,label)+(' • '+location if location else '')
            exceptions.append([week,safe_text(description),safe_text(asset)])
        for asset in row.get('missing_assets',[]):exceptions.append([week,'تعداد تاریخی تأیید نشده' if {**row['quantities'],**row.get('additional_quantities',{})}.get(asset) is None else 'قیمت تاریخی تأیید نشده',safe_text(asset)])
        if not gold:exceptions.append([week,'قیمت تاریخی هر گرم طلای ۱۸ عیار تأیید نشده',''])
    analysis=book.create_sheet('خلاصه تحلیل')
    analysis.append(['شاخص','مقدار'])
    analysis.append(['پایان هفته','چهارشنبه، به وقت تهران'])
    analysis.append(['قیمت در تعطیلی جنگی تأییدشده','آخرین قیمت پایانی روز باز بازار، با حفظ تاریخ واقعی قیمت'])
    final=[r for r in history['weeks'] if r['mode']!='baseline']
    valid=[r for r in final if r['status']=='complete']
    analysis.append(['هفته‌های ثبت‌شده',len(final)])
    analysis.append(['هفته‌های دارای ارزش محاسبه‌شده',len(valid)])
    analysis.append(['هفته‌های برآوردی با آخرین قیمت موجود',sum(r.get('valuation_basis')=='estimated_last_known' for r in valid)])
    if history.get('historical_price_policy')==LAST_KNOWN_POLICY:analysis.append(['روش قیمت‌های ناموجود','آخرین قیمت موجود در تاریخ ارزش‌گذاری یا پیش از آن؛ بدون استفاده از قیمت آینده'])
    analysis.append(['هفته‌های نیازمند بررسی',len(final)-len(valid)])
    endpoints=len(final)>1 and final[0]['status']=='complete' and final[-1]['status']=='complete'
    analysis.append(['تغییر ارزش در بازه (گرم طلای ۱۸ عیار)',final[-1]['gold_grams']-final[0]['gold_grams'] if endpoints else None])
    analysis.append(['کمترین ارزش محاسبه‌شده (گرم)',min(r['gold_grams'] for r in valid) if valid else None])
    analysis.append(['بیشترین ارزش محاسبه‌شده (گرم)',max(r['gold_grams'] for r in valid) if valid else None])
    for row in summary.iter_rows(min_row=2):
        for col in [1,2]:row[col].number_format='0.000000'
        for col in [4,5]:row[col].number_format='#,##0'
    chart=LineChart();chart.title='ارزش پرتفوی بر حسب طلای ۱۸ عیار';chart.y_axis.title='گرم';chart.x_axis.title='هفته';chart.display_blanks='gap'
    chart.add_data(Reference(summary,min_col=2,min_row=1,max_row=summary.max_row),titles_from_data=True)
    chart.set_categories(Reference(summary,min_col=1,min_row=2,max_row=summary.max_row));chart.width=25;chart.height=13;summary.add_chart(chart,'L2')
    for sheet in book:
        sheet.sheet_view.rightToLeft=True;sheet.freeze_panes='A2';sheet.auto_filter.ref=sheet.dimensions
        for cell in sheet[1]:cell.font=Font(name='Tahoma',bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='17283E');cell.alignment=Alignment(horizontal='center')
        for column in sheet.columns:sheet.column_dimensions[column[0].column_letter].width=24
    for row in summary.iter_rows(min_row=2):
        for col in [0,8,9]:row[col].font=Font(name='Tahoma',bold=True)
    for sheet,columns in [(holdings,[0,7]),(allocations,[0]),(exceptions,[0])]:
        for row in sheet.iter_rows(min_row=2):
            for col in columns:row[col].font=Font(name='Tahoma',bold=True)
    stream=BytesIO();book.save(stream);return stream.getvalue()  # New report workbook only.


def publish_export():
    history=api('?data=gold-history');config=api('?data=gold-history-config')
    data=export_excel(history,config['groups'])
    result=api('?sync=gold-history-file',{'revision':history['revision'],'content_base64':base64.b64encode(data).decode()})
    if result.get('ok') is not True or result.get('revision')!=history['revision']:raise SyncError('history_export_not_verified')
    readback=api('?data=gold-history-file')
    if readback.get('revision')!=history['revision'] or readback.get('sha256')!=hashlib.sha256(data).hexdigest():raise SyncError('history_export_readback_mismatch')
    return {'weeks':sum(w['mode']!='baseline' for w in history['weeks']),'observations':len(history['weeks']),'complete_weeks':sum(w['mode']!='baseline' and w['status']=='complete' for w in history['weeks']),'complete_observations':sum(w['status']=='complete' for w in history['weeks']),'excel_stored':True}


def additional_observation(content,config):
    _,_,_,extra=reconstruct(content,config)
    quantities={a:r['current'] for a,r in extra.holdings.items()};quotes={}
    asof=datetime.now(timezone.utc);fx=None
    if any(q and a in CRYPTO for a,q in quantities.items()):
        try:fx=last_quote(tgju_history('price_dollar_rl'),asof,'TGJU USD/IRR daily close')
        except Exception:pass
    for asset,q in quantities.items():
        if not q:continue
        try:
            if asset in CRYPTO:
                p=last_quote(crypto_history(asset),asof,'CoinGecko USD')
                if p and fx:quotes[asset]={'price_rial':p['price_rial']*fx['price_rial'],
                    'quoted_at':min(p['quoted_at'],fx['quoted_at']),'source':'CoinGecko USD × TGJU USD/IRR'}
            else:
                values=listed_history(asset);p=last_quote(values,asof,getattr(values,'source','TSETMC official daily market price (IRR)'))
                if p:quotes[asset]=p
        except Exception:pass
    return quantities,quotes


def run(action):
    diagnostics={}
    if action!='export':
        token=graph_token();content,modified=download_workbook(token);checked=utcnow()
        config=api('?data=gold-history-config');existing=api('?data=gold-history')
        if action in ('backfill','bootstrap'):
            rows,diagnostics=historical_weeks(content,modified,checked,config,existing)
            result=api('?sync=gold-history',{'revision':existing['revision'],'calendar':HISTORY_CALENDAR,'weeks':rows})
            if result.get('ok') is not True:raise SyncError('history_not_stored')
        if action in ('capture','bootstrap'):
            if action=='bootstrap':content,modified=download_workbook(token);checked=utcnow()
            additional,quotes=additional_observation(content,config)
            result=api('?sync=gold-observation',{'assets':extract_quantities(content),'workbook_updated_at':modified,'source_checked_at':checked,
                'workbook_sha256':hashlib.sha256(content).hexdigest(),'additional_quantities':additional,'additional_quotes':quotes,'notify':action=='capture','bootstrap':action=='bootstrap'})
            if result.get('ok') is not True:raise SyncError('weekly_observation_not_stored')
    return {'ok':True,**diagnostics,**publish_export()}

if __name__=='__main__':
    try:
        action=os.environ.get('HISTORY_ACTION','export')
        if action not in ('export','backfill','capture','bootstrap'):raise SyncError('invalid_history_action')
        print(json.dumps(run(action)))
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error) if isinstance(error,SyncError) else 'gold_history_failed'}))
        raise SystemExit(1)
