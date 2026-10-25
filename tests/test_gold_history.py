from datetime import date,datetime,timezone
from io import BytesIO
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET
import zipfile

from openpyxl import Workbook,load_workbook
from openpyxl.worksheet.table import Table,TableColumn
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import gold_history as history
from verify_onedrive import MAPPING


def source_workbook(*,ambiguous=False,mismatch=False,extra=False):
    book=Workbook();book.remove(book.active);totals={}
    for i,(asset,spec) in enumerate(MAPPING.items()):
        sheet=book.create_sheet('Fixture'+str(i));sheet.append([spec['column'],'Date' if asset in history.CRYPTO else 'تاریخ'])
        if asset=='بلک راک':
            sheet.append([15,datetime(2026,9,28)]);sheet.append([None,None]);total=15
        else:
            sheet.append([10,'01/02/2025' if ambiguous and i==0 else datetime(2025,2,1)])
            sheet.append([-4,datetime(2026,9,26)]);total=6
        sheet.append(['=SUBTOTAL(109,A2:A3)',None])
        cols=[TableColumn(id=1,name=spec['column'],totalsRowFunction='sum'),TableColumn(id=2,name=sheet.cell(1,2).value)]
        sheet.add_table(Table(displayName=spec['table'],ref='A1:B4',tableColumns=cols,totalsRowCount=1))
        totals[f'xl/worksheets/sheet{i+1}.xml']=total+(1 if mismatch and i==0 else 0)
    if extra:
        sheet=book.create_sheet('OldAssetFixture');sheet.append(['Quantity','Date']);sheet.append([1,datetime(2025,1,1)]);sheet.append([0,None]);
        sheet.add_table(Table(displayName='UnknownOldHolding',ref='A1:B3',tableColumns=[TableColumn(id=1,name='Quantity'),TableColumn(id=2,name='Date')],totalsRowCount=1))
    raw=BytesIO();book.save(raw);out=BytesIO();ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(raw) as src,zipfile.ZipFile(out,'w') as dst:
        for name in src.namelist():
            data=src.read(name)
            if name in totals:
                root=ET.fromstring(data);root.find('.//s:c[@r="A4"]/s:v',ns).text=str(totals[name]);data=ET.tostring(root)
            dst.writestr(name,data)
    return out.getvalue()


class HistoricalQuantityTests(unittest.TestCase):
    def test_dates_support_excel_solar_hijri_and_unambiguous_english_without_guessing(self):
        for value in [datetime(2026,9,28),'2026/09/28','1405/07/06','۱۴۰۵/۰۷/۰۶','09/28/2026','28/09/2026']:
            self.assertEqual(history.parse_trade_date(value),date(2026,9,28))
        self.assertEqual(history.parse_trade_date('1405/01/01'),date(2026,3,21))
        for value in [None,'01/02/2026','2025/10/231','2025/10/01 & 2025/10/02','هزینه گم شده']:
            with self.assertRaises(ValueError):history.parse_trade_date(value)

    def test_reconstruction_uses_signed_dated_trades_reconciled_to_current_totals_and_fund_launch(self):
        content=source_workbook();before=bytes(content)
        current,trades,problems,extras=history.reconstruct(content,{})
        self.assertFalse(extras);self.assertTrue(all(not issue for issue in problems.values()))
        first=history.quantities_at(date(2025,10,31),trades,problems,{'دلار':100})
        last=history.quantities_at(date(2026,10,23),trades,problems,{'دلار':100})
        self.assertEqual(first['طلا'],10);self.assertEqual(last['طلا'],6)
        self.assertEqual(first['بلک راک'],0);self.assertEqual(last['بلک راک'],15)
        self.assertEqual(last['دلار'],100);self.assertEqual(current['طلا'],last['طلا']);self.assertEqual(content,before)

    def test_ambiguous_dates_and_reconciliation_errors_remain_unknown_and_extra_trade_tables_are_detected(self):
        for kwargs in [{'ambiguous':True},{'mismatch':True}]:
            _,trades,problems,_=history.reconstruct(source_workbook(**kwargs),{})
            quantities=history.quantities_at(date(2026,10,23),trades,problems,{})
            self.assertIsNone(quantities['طلا']);self.assertTrue(problems['طلا'])
        _,_,_,extras=history.reconstruct(source_workbook(extra=True),{});self.assertEqual(extras,['OldAssetFixture / UnknownOldHolding'])

    def test_week_grid_has_52_actual_fridays_inside_the_confirmed_year(self):
        weeks=history.week_dates();self.assertEqual(len(weeks),52);self.assertEqual(len(set(weeks)),52)
        self.assertTrue(all(d.weekday()==4 for d in weeks));self.assertEqual(weeks[0],date(2025,10,31));self.assertEqual(weeks[-1],date(2026,10,23))

    def test_historical_quote_selection_never_uses_a_future_or_overly_stale_quote(self):
        cutoff=datetime(2026,10,23,23,59,tzinfo=history.TEHRAN)
        data=[(datetime(2026,10,1,tzinfo=history.TEHRAN),1),(datetime(2026,10,22,tzinfo=history.TEHRAN),2),(datetime(2026,10,24,tzinfo=history.TEHRAN),3)]
        self.assertEqual(history.last_quote(data,cutoff,'Synthetic')['price_rial'],2)
        self.assertIsNone(history.last_quote(data[:1],cutoff,'Synthetic'))

    def test_backfill_uses_historical_crypto_fx_units_and_does_not_price_fund_before_launch_or_use_guest_fallback(self):
        stamp=datetime(2026,10,20,tzinfo=history.TEHRAN)
        def tgju(slug):return [(stamp,200000000 if slug=='geram18' else 1000000)]
        config={'manual':{'سکه تمام':1,'ربع سکه بانکی':1,'ربع سکه غیره':1,'آبشده (طلب)':1,'آبشده (شمش زربد)':1,'دلار':100}}
        with patch.object(history,'tgju_history',side_effect=tgju),patch.object(history,'listed_history',return_value=[(stamp,100000)]),patch.object(history,'crypto_history',return_value=[(stamp,10)]):
            rows,_=history.historical_weeks(source_workbook(),'2026-10-24T00:00:00Z','2026-10-25T00:00:00Z',config,{})
        self.assertEqual(rows[-1]['quotes']['BTC']['price_rial'],10000000)
        self.assertEqual(rows[0]['quantities']['بلک راک'],0);self.assertNotIn('بلک راک',rows[-1]['quotes'])
        self.assertNotIn('شمش نقره 999',rows[-1]['quotes'])


class HistoryExcelTests(unittest.TestCase):
    def test_new_workbook_contains_real_chart_blank_gaps_sources_and_no_macros_or_formula_injection(self):
        def row(day,complete=True):
            return {'week_ending':day,'as_of':day+'T20:29:59Z','source_checked_at':'2026-10-25T10:00:00Z','mode':'historical',
                'status':'complete' if complete else 'incomplete','gold_grams':10 if complete else None,'total_rial':2000000000 if complete else None,
                'gold_quote':{'price_rial':200000000},'quantities':{'Stock':10,'Dust':.0001},'quotes':{
                    'Stock':{'price_rial':10000000,'source':'=HYPERLINK("unsafe")','quoted_at':day+'T00:00:00Z'},
                    'Dust':{'price_rial':1000,'source':'Synthetic','quoted_at':day+'T00:00:00Z'}},
                'allocation':{'Stock':100} if complete else None,'included_values':{'Stock':100000000} if complete else None,'missing_assets':[],'issues':[]}
        data=history.export_excel({'weeks':[row('2026-10-16'),row('2026-10-23',False)]},{'Stock':'سهام','Dust':'رمزارز'})
        book=load_workbook(BytesIO(data),data_only=False)
        self.assertEqual(book.sheetnames,['ارزش هفتگی','دارایی‌ها','ترکیب دارایی','موارد نیازمند بررسی','خلاصه تحلیل'])
        self.assertEqual(book['ارزش هفتگی']['B2'].value,10);self.assertIsNone(book['ارزش هفتگی']['B3'].value)
        self.assertEqual(book['ارزش هفتگی']._charts[0].display_blanks,'gap');self.assertTrue(book['ارزش هفتگی']['I2'].font.bold)
        self.assertEqual(book['دارایی‌ها'].max_row,3);self.assertTrue(book['دارایی‌ها']['G2'].value.startswith("'="))
        self.assertTrue(all(cell.data_type!='f' for sheet in book for rows in sheet for cell in rows))
        with zipfile.ZipFile(BytesIO(data)) as archive:self.assertFalse(any('vba' in name.lower() for name in archive.namelist()))
        book.close()

class BoundedArchiveRequestTests(unittest.TestCase):
    def test_public_archive_request_has_a_hard_timeout_and_never_forwards_credentials(self):
        with patch.object(history.request,'build_opener') as factory:
            response=factory.return_value.open.return_value.__enter__.return_value
            response.read.return_value=b'{"data":[]}'
            self.assertEqual(history.market_json('https://api.tgju.org/v1/example'),{'data':[]})
            call=factory.return_value.open.call_args
            self.assertEqual(call.kwargs['timeout'],8)
            self.assertNotIn('Authorization',call.args[0].headers)
        with self.assertRaises(history.SyncError):history.market_json('https://example.invalid/private')

    def test_archive_timeout_produces_explicit_missing_quotes_without_losing_reconstructed_quantities(self):
        with patch.object(history,'market_json',side_effect=TimeoutError()):
            rows,_=history.historical_weeks(source_workbook(),'2026-10-24T00:00:00Z','2026-10-25T00:00:00Z',{'manual':{'دلار':100}}, {})
        self.assertEqual(len(rows),52);self.assertEqual(rows[-1]['quantities']['طلا'],6)
        self.assertIsNone(rows[-1]['gold_quote']);self.assertEqual(rows[-1]['quotes'],{})
