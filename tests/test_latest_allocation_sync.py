import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import latest_allocation_sync as sync


class SynchronizationTests(unittest.TestCase):
    def setUp(self):
        self.assets = dict.fromkeys(sync.extract_quantities.__globals__['MAPPING'], 0)
        self.stamp = '2026-01-02T00:00:00Z'
        self.snapshot = {'assets':self.assets,'updated_at':self.stamp,'workbook_updated_at':self.stamp}

    def execute(self, *, readback=None, source='2026-01-02T00:00:00Z', previous=None):
        with patch.dict(os.environ, {'PORTFOLIO_ONDEMAND_ENABLED':'true','PORTFOLIO_SYNC_SECRET_AGENT':'fixture'}, clear=True), \
             patch.object(sync,'read_snapshot',side_effect=[previous or self.snapshot,readback or self.snapshot]), \
             patch.object(sync,'graph_token',return_value='fixture'), \
             patch.object(sync,'download_workbook',return_value=(b'fixture',source)), \
             patch.object(sync,'extract_quantities',return_value=self.assets), \
             patch.object(sync,'utcnow',return_value=self.stamp), \
             patch.object(sync,'json_request',return_value={'ok':True,'stored':True,'received':23}) as write:
            return sync.synchronize(), write

    def test_complete_unchanged_workbook_with_zeros_and_exact_readback(self):
        result, write = self.execute()
        self.assertTrue(result['readback_verified'])
        self.assertEqual(write.call_args.kwargs['retries'],0)
        self.assertEqual(json.loads(write.call_args.kwargs['body'])['assets'],self.assets)

    def test_mismatched_readback_is_not_success(self):
        with self.assertRaisesRegex(sync.SyncError,'production_readback_mismatch'):
            self.execute(readback={**self.snapshot,'updated_at':'2026-01-03T00:00:00Z'})

    def test_older_or_future_sources_fail(self):
        for source,code in [('2026-01-01T00:00:00Z','older_workbook_rejected'),('2099-01-01T00:00:00Z','future_workbook_rejected')]:
            with self.assertRaisesRegex(sync.SyncError,code):self.execute(source=source)

    def test_prior_read_failure_prevents_graph_and_write(self):
        with patch.dict(os.environ,{'PORTFOLIO_ONDEMAND_ENABLED':'true','PORTFOLIO_SYNC_SECRET_AGENT':'fixture'},clear=True), \
             patch.object(sync,'read_snapshot',side_effect=sync.SyncError('http_500')), \
             patch.object(sync,'graph_token') as graph, patch.object(sync,'json_request') as write:
            with self.assertRaises(sync.SyncError):sync.synchronize()
            graph.assert_not_called();write.assert_not_called()

    def test_disabled_sync_never_reads_or_writes(self):
        with patch.dict(os.environ,{},clear=True),patch.object(sync,'read_snapshot') as read:
            with self.assertRaisesRegex(sync.SyncError,'on_demand_sync_disabled'):sync.synchronize()
            read.assert_not_called()

    def test_completion_payload_has_no_holdings_or_chat_id_and_no_blind_retry(self):
        with patch.dict(os.environ,{'PORTFOLIO_SYNC_SECRET_AGENT':'fixture'},clear=True), \
             patch.object(sync,'json_request',return_value={'ok':True}) as request:
            sync.notify('00000000-0000-4000-8000-000000000001',{'ok':True,'snapshot_updated_at':self.stamp})
            body=json.loads(request.call_args.kwargs['body'])
            self.assertEqual(set(body),{'request_id','ok','snapshot_updated_at'})
            self.assertEqual(request.call_args.kwargs['retries'],0)


if __name__ == '__main__':unittest.main()
