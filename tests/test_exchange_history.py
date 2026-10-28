import json
from datetime import date,datetime
from unittest import TestCase
from unittest.mock import patch
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import gold_history as h


def fixture(symbol='طلا',kind='fund',rows=None):
    rows=rows if rows is not None else [{'trade_date':'2026-10-22','close_price':12000,'real_close_price':12500,'volume':100,'trade_count':4},
        {'trade_date':'2026-10-21','close_price':11000,'real_close_price':11500,'volume':100,'trade_count':4}]
    identity={'@type':'Corporation','tickerSymbol':symbol,'url':'https://www.shakhesban.com/markets/'+kind+'/'+symbol}
    stream='42:'+json.dumps(['$','component',None,{'rows':rows}],ensure_ascii=False)+'\n'
    half=len(stream)//2
    return '<script type="application/ld+json">'+json.dumps(identity,ensure_ascii=False)+'</script>'+''.join('<script>self.__next_f.push('+json.dumps([1,s],ensure_ascii=False)+')</script>' for s in [stream[:half],stream[half:]])


class ExchangeHistoryTests(TestCase):
    def test_published_closing_column_and_split_server_payload_are_parsed_without_executing_scripts(self):
        html=fixture()+'<script>throw new Error("must never execute")</script>'
        rows=h.parse_shakhesban_history(html,'طلا')
        self.assertEqual([p for _,p in rows],[11000,12000])
        self.assertEqual(rows[0][0].date(),date(2026,10,21))
        self.assertEqual(rows.source,'Shakhesban historical daily close (IRR)')
        self.assertIsNone(h.last_quote(rows,datetime(2026,10,20,tzinfo=h.TEHRAN),rows.source))
        self.assertIsNone(h.last_quote(rows,datetime(2026,11,2,tzinfo=h.TEHRAN),rows.source))

    def test_exact_symbol_asset_type_and_canonical_provider_identity_are_required(self):
        for html in [fixture('عیار'),fixture('طلا','stock'),fixture().replace('www.shakhesban.com','untrusted.invalid')]:
            with self.assertRaises(h.SyncError):h.parse_shakhesban_history(html,'طلا')
        self.assertTrue(h.parse_shakhesban_history(fixture('فلزفارابی'),'فلز فارابی'))

    def test_conflicting_days_and_untraded_or_invalid_prices_are_not_market_quotes(self):
        valid={'trade_date':'2026-10-22','close_price':12000,'volume':10,'trade_count':1}
        with self.assertRaises(h.SyncError):h.parse_shakhesban_history(fixture(rows=[valid,{**valid,'close_price':14000}]),'طلا')
        for change in [{'close_price':True},{'close_price':float('nan')},{'close_price':0},{'volume':0},{'trade_count':0}]:
            with self.assertRaises(h.SyncError):h.parse_shakhesban_history(fixture(rows=[{**valid,**change}]),'طلا')

    def test_official_provider_remains_a_fallback_and_provenance_is_preserved(self):
        expected=h.PriceSeries([(datetime(2026,10,22,tzinfo=h.TEHRAN),10000)],'TSETMC official daily market price (IRR)')
        with patch.object(h,'market_text',side_effect=TimeoutError()),patch.object(h,'tsetmc_history',return_value=expected):
            self.assertIs(h.listed_history('طلا'),expected)
        with patch.object(h,'market_text',return_value=fixture()),patch.object(h,'tsetmc_history') as official:
            self.assertEqual(h.listed_history('طلا').source,'Shakhesban historical daily close (IRR)');official.assert_not_called()

    def test_archive_http_is_bounded_https_only_and_does_not_forward_credentials(self):
        with patch.object(h.request,'build_opener') as factory:
            response=factory.return_value.open.return_value.__enter__.return_value;response.read.return_value=fixture().encode()
            h.market_text('https://www.shakhesban.com/markets/fund/test/history')
            call=factory.return_value.open.call_args
            self.assertEqual(call.kwargs['timeout'],8);self.assertNotIn('Authorization',call.args[0].headers)
        for url in ['http://www.shakhesban.com/history','https://untrusted.invalid/history','https://user:password@www.shakhesban.com/history']:
            with self.assertRaises(h.SyncError):h.market_text(url)

    def test_previous_verified_rial_quote_survives_outage_without_reusing_live_stale_or_wrong_currency_data(self):
        asof=datetime(2026,10,23,23,59,tzinfo=h.TEHRAN)
        raw={'price_rial':12000,'quoted_at':'2026-10-22T00:00:00Z','source':'Shakhesban historical daily close (IRR)'}
        row={'mode':'historical','quotes':{'طلا':raw}}
        self.assertEqual(h.saved_listed_quote(row,'طلا',asof),{**raw,'quoted_at':'2026-10-22T00:00:00+00:00'})
        self.assertIsNone(h.saved_listed_quote({**row,'mode':'live'},'طلا',asof))
        for update in [{'quoted_at':'2026-10-01T00:00:00Z'},{'quoted_at':'2026-10-25T00:00:00Z'},{'source':'NAV USD'},{'price_rial':-1}]:
            self.assertIsNone(h.saved_listed_quote({'mode':'historical','quotes':{'طلا':{**raw,**update}}},'طلا',asof))
