"""Import numeric owner price rows only; attachment text is never executed.

Run locally with an explicit currency. No source XLSM or public repository data
is written. The authenticated history API retains the dated private inputs.
"""
import argparse
from datetime import date,datetime,time
import hashlib
import json
import math
from pathlib import Path
import re

import jdatetime
from gold_history import api,TEHRAN,DIGITS,LAST_KNOWN_POLICY
from verify_onedrive import SyncError,MAPPING


def parse_price_document(text,currency,*,silver_currency=None,document_sha256=None):
    if currency not in {'TOMAN','IRR'} or silver_currency not in {None,'TOMAN','IRR'}:raise SyncError('explicit_price_currency_required')
    digest=document_sha256 or hashlib.sha256(text.encode()).hexdigest()
    allowed=set(MAPPING)|{'ربع سکه بانکی','سکه تمام','ربع سکه غیره','آبشده (طلب)','آبشده (شمش زربد)','دلار','اهرم','XAUT'}
    asset=None;records=[];seen=set()
    for line in text.splitlines():
        line=line.strip()
        header=re.fullmatch(r'(.+) \(\d+ weeks?\)',line)
        if header:
            asset=header[1]
            if asset not in allowed:raise SyncError('unknown_price_asset')
            continue
        if '|' not in line or not line[:1].translate(DIGITS).isdigit():continue
        fields=[s.strip().translate(DIGITS) for s in line.split('|')]
        if not asset or len(fields) not in {2,3}:raise SyncError('invalid_price_row')
        try:
            solar=jdatetime.date(*map(int,fields[0].split('/'))).togregorian();day=date.fromisoformat(fields[1])
        except (TypeError,ValueError):raise SyncError('invalid_price_date') from None
        if solar!=day:raise SyncError('price_calendar_mismatch')
        if len(fields)==2 or fields[2] in {'','ticker was closed'}:continue
        if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?',fields[2]):raise SyncError('invalid_unit_price')
        amount=float(fields[2]);unit=(silver_currency or currency) if asset=='شمش نقره 999' else currency
        price=amount*(10 if unit=='TOMAN' else 1)
        if not math.isfinite(price) or price<=0 or price>2**53-1:raise SyncError('invalid_unit_price')
        key=(asset,day)
        if key in seen:raise SyncError('duplicate_price_date')
        seen.add(key)
        records.append({'asset':asset,'quoted_at':datetime.combine(day,time.max,TEHRAN).isoformat(),
            'price_rial':price,'original_price':amount,'original_currency':unit,'document_sha256':digest})
    if not records:raise SyncError('no_dated_prices')
    return records


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file',type=Path);parser.add_argument('--currency',required=True,choices=['TOMAN','IRR'])
    parser.add_argument('--silver-currency',choices=['TOMAN','IRR']);parser.add_argument('--apply',action='store_true')
    args=parser.parse_args();raw=args.file.read_bytes()
    if len(raw)>100000:raise SyncError('price_document_too_large')
    records=parse_price_document(raw.decode('utf-8-sig'),args.currency,silver_currency=args.silver_currency,document_sha256=hashlib.sha256(raw).hexdigest())
    if args.apply:
        current=api('?data=gold-history')
        result=api('?sync=gold-history-prices',{'revision':current['revision'],'historical_price_policy':LAST_KNOWN_POLICY,'price_inputs':records})
        after=api('?data=gold-history')
        if not result.get('ok') or after['revision']!=result['revision'] or after.get('historical_price_policy')!=LAST_KNOWN_POLICY:raise SyncError('price_import_not_verified')
        stored={(p['asset'],datetime.fromisoformat(p['quoted_at'].replace('Z','+00:00')).astimezone(TEHRAN).date()):p for p in after['price_inputs']}
        for p in records:
            key=(p['asset'],datetime.fromisoformat(p['quoted_at']).date())
            if stored.get(key,{}).get('price_rial')!=p['price_rial'] or stored[key].get('document_sha256')!=p['document_sha256']:raise SyncError('price_import_readback_mismatch')
    print(json.dumps({'ok':True,'dated_price_rows':len(records),'asset_count':len({p['asset'] for p in records}),'stored_and_verified':args.apply}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'ok':False,'error':str(error) if isinstance(error,SyncError) else 'price_import_failed'}));raise SystemExit(1)
