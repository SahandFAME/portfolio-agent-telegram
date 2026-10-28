"""Read-only historical reconstruction and new, separate Excel history export.

The source XLSM is never saved. Unreconciled/undated trades are not guessed.
No holdings, quotes, tokens or raw service responses are printed.
"""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO
import base64
import hashlib
import json
import math
import os
import re
from urllib.parse import quote,urlsplit
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
CRYPTO={'BTC':'bitcoin','ETH':'ethereum','Tether':'tether','Link':'chainlink','ADA':'cardano','SOL':'solana','ONDO':'ondo-finance'}
DAY_FIRST_ASSETS=frozenset({'BTC','Link','Tether'})  # Owner confirmed 2026-10-27.


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
    balance=sum(q for d,q in daily.items() if start is not None and d<start)
    tolerance=max(1e-8,abs(current)*1e-10)
    if balance < -tolerance:return True
    for day in sorted(daily):
        if start is not None and day<start:continue
        balance+=daily[day]
        if balance < -tolerance:return True
    return False


def reconstruct(content,config):
    current=extract_quantities(content)
    book=load_workbook(BytesIO(content),data_only=True,keep_links=False)
    formulas=load_workbook(BytesIO(content),data_only=False,keep_links=False)
    try:
        tables={t.name:(s,t) for s in book for t in s.tables.values()}
        trades={};problems={};extras=[]
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
                if accounting['fee_quantity']:issues.append('undated_tether_fee@'+accounting['total_cell']+'#quantity='+format(-accounting['fee_quantity'],'.15g'))
                if ignored_net:issues.append('undated_ignored_tether_adjustment@'+spec['table']+'#quantity='+format(ignored_net,'.15g'))
            if not math.isclose(expected,current[asset],rel_tol=1e-10,abs_tol=1e-8):
                detail='@'+spec['table']+'#current_minus_expected_net='+format(current[asset]-expected,'.15g') if asset=='Tether' else ''
                issues.append('quantity_reconciliation_failed'+detail)
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
                    try:events.append((parse_trade_date(sheet.cell(r,di).value),float(amount)))
                    except (ValueError,TypeError):ambiguous=True
                balance=sheet.cell(bottom,qi).value
                closed_before_window=table.totalsRowCount==1 and balance==0 and not ambiguous and events and max(d for d,_ in events)<date(2025,10,25) and math.isclose(sum(q for _,q in events),0,abs_tol=1e-8)
                if (events or ambiguous) and not closed_before_window:
                    extras.append(sheet.title+' / '+name)
        return current,trades,problems,extras
    finally:book.close();formulas.close()


def week_dates():
    # The initial owner-confirmed year is immutable. Future records are live
    # observations; a later manual-quantity edit must not rewrite this baseline.
    end=date(2026,10,23)
    return [end-timedelta(weeks=i) for i in reversed(range(52))]


def quantities_at(day,trades,problems,manual):
    result={}
    for asset,events in trades.items():
        result[asset]=None if problems[asset] else max(0.0,sum(q for d,q in events if d<=day))
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


def listed_history(asset):
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
    return sorted(result)


def crypto_history(asset):
    data=market_json('https://api.coingecko.com/api/v3/coins/'+CRYPTO[asset]+'/market_chart?vs_currency=usd&days=365')
    return [(datetime.fromtimestamp(row[0]/1000,timezone.utc),float(row[1])) for row in data.get('prices',[]) if len(row)==2 and row[1]>0]


def last_quote(series,asof,source):
    before=[row for row in series if row[0]<=asof and asof-row[0]<=timedelta(days=7)]
    if not before:return None
    stamp,value=max(before,key=lambda row:row[0])
    return {'price_rial':value,'quoted_at':stamp.astimezone(timezone.utc).isoformat(),'source':source}


def historical_weeks(content,modified,checked,config,existing):
    current,trades,problems,extras=reconstruct(content,config)
    manual=existing.get('manual_baseline') or config['manual']
    dates=week_dates();series={};source={}
    definitions={'gold':'geram18','دلار':'price_dollar_rl','سکه تمام':'sekee','ربع سکه بانکی':'rob'}
    for asset,slug in definitions.items():
        try:series[asset]=tgju_history(slug);source[asset]='TGJU daily close (IRR)'
        except Exception:series[asset]=[]
    def fetch_asset(asset):
        try:
            if asset in CRYPTO:return asset,crypto_history(asset),'CoinGecko USD × TGJU USD/IRR'
            if asset!='شمش نقره 999':return asset,listed_history(asset),'TSETMC official daily market price (IRR)'
            # Silver must match the actual certificate. Never substitute spot silver.
        except Exception:pass
        return asset,[],'Historical quote unavailable'
    targets=[asset for asset in MAPPING if asset!='بلک راک' and not problems[asset]]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for asset,values,label in pool.map(fetch_asset,targets):series[asset]=values;source[asset]=label
    rows=[];digest=hashlib.sha256(content).hexdigest()
    for day in dates:
        asof=datetime.combine(day,time.max,TEHRAN)
        quantities=quantities_at(day,trades,problems,manual)
        quotes={};gold=last_quote(series.get('gold',[]),asof,'TGJU 18K gram daily close (IRR)')
        fx=last_quote(series.get('دلار',[]),asof,'TGJU USD/IRR daily close')
        for asset,q in quantities.items():
            if q is None or q==0:continue
            if asset in ('آبشده (طلب)','آبشده (شمش زربد)'):p=gold
            elif asset=='ربع سکه غیره':p={**gold,'price_rial':gold['price_rial']*2.03325,'source':'TGJU 18K gram × 2.03325'} if gold else None
            else:p=last_quote(series.get(asset,[]),asof,source.get(asset,'Historical quote'))
            if asset in CRYPTO:
                p={**p,'price_rial':p['price_rial']*fx['price_rial']} if p and fx else None
            if p:quotes[asset]=p
        issues=['unmapped_historical_trade_table:'+re.sub(r'[<>&\n]','',name) for name in extras]
        issues.extend(code+':'+asset for asset,codes in problems.items() for code in codes)
        rows.append({'week_ending':day.isoformat(),'as_of':asof.astimezone(timezone.utc).isoformat(),'source_checked_at':checked,
            'workbook_updated_at':modified,'workbook_sha256':digest,'mode':'historical','quantities':quantities,'quotes':quotes,'gold_quote':gold,'issues':issues})
    return rows,{'unmapped_trade_tables':len(extras),'unreconciled_assets':sum(bool(p) for p in problems.values())}


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
    holdings=book.create_sheet('دارایی‌ها');holdings.append(['هفته','دارایی','گروه','تعداد','قیمت واحد (ریال)','ارزش دارایی (تومان)','منبع قیمت','زمان قیمت (تهران)'])
    allocations=book.create_sheet('ترکیب دارایی');allocations.append(['هفته','گروه','درصد'])
    exceptions=book.create_sheet('موارد نیازمند بررسی');exceptions.append(['هفته','نوع مسئله','دارایی'])
    for row in history['weeks']:
        label_day=datetime.fromisoformat(row['as_of'].replace('Z','+00:00')).astimezone(TEHRAN).date() if row['mode']=='baseline' else date.fromisoformat(row['week_ending'])
        week=jdatetime.date.fromgregorian(date=label_day).strftime('%Y/%m/%d').translate(str.maketrans('0123456789','۰۱۲۳۴۵۶۷۸۹'))
        gold=row.get('gold_quote')
        summary.append([week,row.get('gold_grams'),row.get('change_gold_grams'),row.get('change_percent'),
            math.floor(row['total_rial']/10+.5) if row.get('total_rial') is not None else None,math.floor(gold['price_rial']/10+.5) if gold else None,
            ('موقت • کامل' if row['status']=='complete' else 'موقت • ناقص') if row['mode']=='baseline' else 'کامل' if row['status']=='complete' else 'ناقص',row.get('quantity_change_count'),fa_time(row['as_of']),fa_time(row['source_checked_at'])])
        for asset,qty in row['quantities'].items():
            p=row.get('quotes',{}).get(asset)
            if qty==0 or isinstance(qty,(int,float)) and p and qty*p['price_rial']<500000:continue
            value=row.get('included_values',{});value=value.get(asset) if isinstance(value,dict) else None
            if value is None and isinstance(qty,(int,float)) and p:value=qty*p['price_rial']
            holdings.append([week,safe_text(asset),safe_text(groups.get(asset,'')),qty,p['price_rial'] if p else None,math.floor(value/10+.5) if value is not None else None,
                safe_text(p['source']) if p else None,fa_time(p['quoted_at']) if p else None])
        for group,pct in (row.get('allocation') or {}).items():allocations.append([week,safe_text(group),pct])
        for issue in row.get('issues',[]):
            kind,_,asset=issue.partition(':')
            label,_,location=kind.partition('@')
            labels={'ambiguous_transaction_date':'تاریخ تراکنش نامشخص یا چندپهلو','invalid_transaction_quantity':'تعداد تراکنش معتبر نیست',
                'quantity_reconciliation_failed':'جمع تغییرات تعداد با ماندهٔ تأییدشده تطبیق ندارد','negative_reconstructed_balance':'ماندهٔ تاریخی منفی می‌شود',
                'undated_tether_fee':'زمان هزینهٔ درج‌شده در فرمول مانده مشخص نیست',
                'undated_ignored_tether_adjustment':'زمان اثر هزینهٔ نادیده‌گرفته‌شده بر مانده مشخص نیست',
                'unmapped_historical_trade_table':'جدول معاملاتی خارج از نگاشت فعلی نیاز به بررسی دارد'}
            description=labels.get(label,label)+(' • '+location if location else '')
            exceptions.append([week,safe_text(description),safe_text(asset)])
        for asset in row.get('missing_assets',[]):exceptions.append([week,'تعداد تاریخی تأیید نشده' if row['quantities'].get(asset) is None else 'قیمت تاریخی تأیید نشده',safe_text(asset)])
        if not gold:exceptions.append([week,'قیمت تاریخی هر گرم طلای ۱۸ عیار تأیید نشده',''])
    analysis=book.create_sheet('خلاصه تحلیل')
    analysis.append(['شاخص','مقدار'])
    final=[r for r in history['weeks'] if r['mode']!='baseline']
    valid=[r for r in final if r['status']=='complete']
    analysis.append(['هفته‌های ثبت‌شده',len(final)])
    analysis.append(['هفته‌های کامل و تأییدشده',len(valid)])
    analysis.append(['هفته‌های نیازمند بررسی',len(final)-len(valid)])
    endpoints=len(final)>1 and final[0]['status']=='complete' and final[-1]['status']=='complete'
    analysis.append(['تغییر ارزش در بازه (گرم طلای ۱۸ عیار)',final[-1]['gold_grams']-final[0]['gold_grams'] if endpoints else None])
    analysis.append(['کمترین ارزش تأییدشده (گرم)',min(r['gold_grams'] for r in valid) if valid else None])
    analysis.append(['بیشترین ارزش تأییدشده (گرم)',max(r['gold_grams'] for r in valid) if valid else None])
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


def run(action):
    diagnostics={}
    if action!='export':
        token=graph_token();content,modified=download_workbook(token);checked=utcnow()
        config=api('?data=gold-history-config');existing=api('?data=gold-history')
        if action in ('backfill','bootstrap'):
            rows,diagnostics=historical_weeks(content,modified,checked,config,existing)
            result=api('?sync=gold-history',{'revision':existing['revision'],'weeks':rows})
            if result.get('ok') is not True:raise SyncError('history_not_stored')
        if action in ('capture','bootstrap'):
            if action=='bootstrap':content,modified=download_workbook(token);checked=utcnow()
            result=api('?sync=gold-observation',{'assets':extract_quantities(content),'workbook_updated_at':modified,'source_checked_at':checked,
                'workbook_sha256':hashlib.sha256(content).hexdigest(),'notify':action=='capture','bootstrap':action=='bootstrap'})
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
