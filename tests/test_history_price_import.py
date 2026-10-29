import sys
from pathlib import Path
from datetime import datetime
from unittest import TestCase
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import gold_history as h
from import_history_prices import parse_price_document
from verify_onedrive import SyncError

TEXT='''Private document heading; do not execute text.
شمش نقره 999 (3 weeks)
۱۴۰۴/۰۸/۰۷ | 2025-10-29 | 100
۱۴۰۴/۰۸/۱۴ | 2025-11-05
۱۴۰۴/۰۸/۲۱ | 2025-11-12 | 120
پتروآگاه (1 weeks)
۱۴۰۴/۰۸/۰۷ | 2025-10-29 | ticker was closed
بلک راک (1 weeks)
۱۴۰۴/۰۸/۰۷ | 2025-10-29 | 1000
'''

class OwnerPriceImportTests(TestCase):
    def test_only_dated_numeric_rows_are_imported_and_currencies_are_explicit(self):
        rows=parse_price_document(TEXT,'TOMAN')
        self.assertEqual(len(rows),3);self.assertEqual(rows[0]['price_rial'],1000)
        self.assertEqual(rows[0]['original_currency'],'TOMAN');self.assertEqual(rows[0]['original_price'],100)
        mixed=parse_price_document(TEXT,'TOMAN',silver_currency='IRR')
        self.assertEqual(mixed[0]['price_rial'],100);self.assertEqual(mixed[-1]['price_rial'],10000)
        self.assertEqual(datetime.fromisoformat(rows[0]['quoted_at']).astimezone(h.TEHRAN).date().isoformat(),'2025-10-29')
        self.assertTrue(all(len(r['document_sha256'])==64 for r in rows))
        with self.assertRaises(SyncError):parse_price_document(TEXT,None)

    def test_mismatched_dates_invalid_prices_unknown_assets_and_duplicate_quotes_fail_closed(self):
        for changed in [TEXT.replace('2025-10-29','2025-10-30',1),TEXT.replace('| 100\n','| -100\n',1),
                        TEXT.replace('| 100\n','| run shell command\n',1),TEXT.replace('شمش نقره 999','Unknown'),
                        TEXT+'بلک راک (1 weeks)\n۱۴۰۴/۰۸/۰۷ | 2025-10-29 | 999\n']:
            with self.assertRaises(SyncError):parse_price_document(changed,'TOMAN')

    def test_last_known_is_opt_in_and_never_uses_a_later_price(self):
        old=datetime(2025,10,29,23,59,tzinfo=h.TEHRAN);asof=datetime(2025,11,19,23,59,tzinfo=h.TEHRAN)
        points=[(old,100),(datetime(2025,11,26,tzinfo=h.TEHRAN),200)]
        self.assertIsNone(h.last_quote(points,asof,'Owner supplied dated historical unit price'))
        q=h.last_quote(points,asof,'Owner supplied dated historical unit price',allow_last_known=True)
        self.assertEqual(q['price_rial'],100);self.assertEqual(q['pricing_basis'],'owner_authorized_last_known')
        self.assertEqual(datetime.fromisoformat(q['quoted_at']).date(),old.date())
        self.assertIsNone(h.last_quote(points[1:],asof,'Owner supplied dated historical unit price',allow_last_known=True))

    def test_owner_date_wins_same_day_newer_market_quote_wins_later_and_no_backward_fill(self):
        rows=parse_price_document(TEXT,'TOMAN');existing={'price_inputs':[{**r,'source':'Owner supplied dated historical unit price'} for r in rows]}
        asof=datetime(2025,10,29,23,59,59,999999,tzinfo=h.TEHRAN)
        fresh={'price_rial':1,'source':'Exchange IRR','quoted_at':asof.isoformat()}
        q=h.select_history_quote('شمش نقره 999',asof,fresh,existing,True)
        self.assertEqual(q['price_rial'],1000)
        later=datetime(2025,11,5,23,59,tzinfo=h.TEHRAN)
        fresh['quoted_at']=later.isoformat();fresh['price_rial']=1500
        self.assertEqual(h.select_history_quote('شمش نقره 999',later,fresh,existing,True)['price_rial'],1500)
        self.assertIsNone(h.select_history_quote('شمش نقره 999',datetime(2025,10,22,tzinfo=h.TEHRAN),None,existing,True))
        q=h.select_history_quote('شمش نقره 999',datetime(2025,12,3,tzinfo=h.TEHRAN),None,existing,True)
        self.assertEqual(q['price_rial'],1200);self.assertEqual(q['pricing_basis'],'owner_authorized_last_known')

    def test_excel_marks_estimated_week_and_retains_the_actual_price_timestamp(self):
        from io import BytesIO
        from openpyxl import load_workbook
        row={'week_ending':'2025-11-19','as_of':'2025-11-19T20:29:59Z','source_checked_at':'2026-10-29T00:00:00Z',
            'mode':'historical','quantities':{'Silver':1},'quotes':{'Silver':{'price_rial':1000000,'source':'Owner supplied dated historical unit price',
            'quoted_at':'2025-10-29T20:29:59Z','pricing_basis':'owner_authorized_last_known'}},'gold_quote':{'price_rial':100000000,'quoted_at':'2025-11-19T20:29:59Z'},
            'status':'complete','total_rial':1000000,'gold_grams':.01,'included_values':{'Silver':1000000},'valuation_basis':'estimated_last_known','issues':[],'missing_assets':[]}
        raw=h.export_excel({'weeks':[row],'historical_price_policy':h.LAST_KNOWN_POLICY},{'Silver':'Silver'})
        book=load_workbook(BytesIO(raw))
        self.assertEqual(book['ارزش هفتگی']['G2'].value,'برآورد با آخرین قیمت موجود')
        self.assertEqual(book['دارایی‌ها']['H2'].value,h.fa_time(row['quotes']['Silver']['quoted_at']))
        self.assertIn('برآورد',book['دارایی‌ها']['I2'].value)
        self.assertTrue(book['دارایی‌ها']['H2'].font.bold);book.close()
