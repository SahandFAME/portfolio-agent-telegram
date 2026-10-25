import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from audit_history_inputs import audit,safe_summary
from test_verify_onedrive import workbook


class HistoryAuditTests(unittest.TestCase):
    def test_audit_exposes_only_schema_counts_and_reconciliation_not_quantities(self):
        content=workbook();before=bytes(content)
        result=audit(content)
        self.assertEqual(result['configured_tables'],23)
        self.assertEqual(result['unconfigured_table_count'],0)
        self.assertTrue(all(row['nonempty_rows']==1 for row in result['tables']))
        self.assertTrue(all(row['transaction_net_matches_current_total'] is False for row in result['tables']))
        self.assertNotIn('999999',json.dumps(result))
        summary=safe_summary(result)
        self.assertEqual(set(summary),{'ok','configured_tables','unconfigured_table_count','reconciliation_failures'})
        self.assertNotIn('tables',summary)
        self.assertEqual(content,before)

    def test_audit_keeps_existing_missing_total_and_incomplete_table_guards(self):
        for opts in [{'no_totals':True},{'omit':True}]:
            with self.assertRaises(Exception):audit(workbook(**opts))
