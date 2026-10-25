import contextlib
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
import tempfile
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
        self.device = {'device_code':'synthetic-device-secret','user_code':'USERCODE',
                       'verification_uri':'https://www.microsoft.com/link','expires_in':30,'interval':5}

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
            self.assertIn('USERCODE',output.getvalue())
            self.assertIn('Open https://www.microsoft.com/link',output.getvalue())
            self.assertNotIn('devicelogin',output.getvalue())

    def test_unexpected_signin_address_rejected_before_polling(self):
        with patch.object(consent.subprocess,'run',return_value=Mock(returncode=0)), \
             patch.object(consent,'oauth',return_value={**self.device,'verification_uri':'https://example.invalid/'}):
            with self.assertRaisesRegex(consent.ConsentError,'unexpected_microsoft_signin_address'):
                consent.authorize()

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

    def test_report_consent_preserves_read_only_secret_and_does_not_print_code(self):
        env={'MICROSOFT_CONSENT_PURPOSE':'report_export','MICROSOFT_SIGNIN_PUBLIC_KEY':'fixture','CONSENT_CHECK_TOKEN':'fixture','GITHUB_SHA':'fixture'}
        output=io.StringIO()
        with patch.dict(os.environ,env),patch.object(consent.subprocess,'run',return_value=Mock(returncode=0)) as run,patch.object(consent,'oauth',side_effect=[self.device,{'refresh_token':'write-secret','scope':'Files.ReadWrite'}]) as oauth,patch.object(consent,'publish_private_signin') as publish,patch.object(consent.time,'sleep'),contextlib.redirect_stdout(output):
            consent.authorize()
            self.assertIn('Files.ReadWrite',oauth.call_args_list[0].args[1]['scope'])
            self.assertIn('MS_GRAPH_EXPORT_REFRESH_TOKEN',run.call_args.args[0]);self.assertNotIn('MS_GRAPH_REFRESH_TOKEN',run.call_args.args[0])
            self.assertNotIn('USERCODE',output.getvalue());self.assertNotIn('write-secret',output.getvalue())
            publish.assert_called_once_with(self.device)

    def test_private_signin_check_contains_only_ciphertext_decryptable_by_requester(self):
        real_run=consent.subprocess.run
        with tempfile.TemporaryDirectory() as directory:
            private=str(Path(directory)/'private.pem')
            real_run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',private],check=True,capture_output=True)
            public=real_run(['openssl','pkey','-in',private,'-pubout'],check=True,capture_output=True).stdout
            calls=[]
            def run(args,**kwargs):
                if args[0]=='openssl':return real_run(args,**kwargs)
                calls.append(kwargs);return Mock(returncode=0)
            env={'MICROSOFT_SIGNIN_PUBLIC_KEY':base64.b64encode(public).decode(),'CONSENT_CHECK_TOKEN':'check-secret','GITHUB_SHA':'fixture'}
            output=io.StringIO()
            with patch.dict(os.environ,env),patch.object(consent.subprocess,'run',side_effect=run),contextlib.redirect_stdout(output):consent.publish_private_signin(self.device)
            body=json.loads(calls[0]['input']);ciphertext=base64.b64decode(body['output']['summary'])
            decrypted=real_run(['openssl','pkeyutl','-decrypt','-inkey',private,'-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256'],input=ciphertext,capture_output=True,check=True).stdout
            self.assertEqual(json.loads(decrypted)['user_code'],'USERCODE')
            self.assertNotIn('device_code',json.loads(decrypted))
            self.assertNotIn('USERCODE',output.getvalue());self.assertNotIn('USERCODE',json.dumps(body))


if __name__ == '__main__':
    unittest.main()
