import contextlib
import importlib.util
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('consent',Path(__file__).parents[1]/'scripts/authorize_microsoft.py')
consent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consent)


class ConsentTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'MS_GRAPH_CLIENT_ID':'11111111-1111-1111-1111-111111111111',
            'GH_TOKEN':'synthetic-secret','GITHUB_REPOSITORY':'SahandFAME/portfolio-agent-telegram'},clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.device = {'device_code':'synthetic-device-secret','user_code':'USER-CODE','expires_in':30,'interval':5}

    def test_github_denial_stops_before_microsoft_consent(self):
        with patch.object(consent.subprocess,'run',return_value=Mock(returncode=1)),patch.object(consent,'oauth') as oauth:
            with self.assertRaisesRegex(consent.ConsentError,'github_secret_access_denied'):
                consent.authorize()
            oauth.assert_not_called()

    def test_token_saved_via_stdin_and_never_printed(self):
        output = io.StringIO()
        with patch.object(consent.subprocess,'run',return_value=Mock(returncode=0)) as run, \
             patch.object(consent,'oauth',side_effect=[self.device,{'error':'authorization_pending'},
                {'refresh_token':'synthetic-refresh-secret','scope':'Files.Read'}]), \
             patch.object(consent.time,'sleep'),contextlib.redirect_stdout(output):
            consent.authorize()
            self.assertEqual(run.call_args.kwargs['input'],b'synthetic-refresh-secret')
            self.assertNotIn('synthetic-refresh-secret',output.getvalue())
            self.assertNotIn('synthetic-device-secret',output.getvalue())
            self.assertIn('USER-CODE',output.getvalue())

    def test_write_scope_rejected(self):
        with patch.object(consent.subprocess,'run',return_value=Mock(returncode=0)) as run, \
             patch.object(consent,'oauth',side_effect=[self.device,{'refresh_token':'fixture','scope':'Files.ReadWrite'}]), \
             patch.object(consent.time,'sleep'),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(consent.ConsentError,'unexpected_write_scope'):
                consent.authorize()
            self.assertEqual(run.call_count,1)

    def test_wrong_repository_rejected(self):
        with patch.dict(os.environ,{'GITHUB_REPOSITORY':'another/repo'}):
            with self.assertRaisesRegex(consent.ConsentError,'unexpected_repository'):
                consent.authorize()

    def test_storage_failure_reported_without_leaking_token(self):
        with patch.object(consent.subprocess,'run',side_effect=[Mock(returncode=0),Mock(returncode=1)]), \
             patch.object(consent,'oauth',side_effect=[self.device,{'refresh_token':'synthetic-secret','scope':'Files.Read'}]), \
             patch.object(consent.time,'sleep'),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(consent.ConsentError,'refresh_token_storage_failed'):
                consent.authorize()


if __name__ == '__main__':
    unittest.main()
