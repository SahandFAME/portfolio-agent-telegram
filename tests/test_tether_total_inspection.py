import base64
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock,patch

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import inspect_tether_total as inspector
from test_gold_history import source_workbook


class PrivateTotalInspectionTests(unittest.TestCase):
    def test_inspection_reads_total_and_opening_row_without_changing_source(self):
        content=source_workbook();before=bytes(content)
        result=inspector.inspect(content)
        self.assertEqual(result['total_cell'],'A4');self.assertEqual(result['first_quantity_cell'],'A2')
        self.assertEqual(result['total_formula'],'=SUBTOTAL(109,A2:A3)')
        self.assertEqual(result['current_total'],6);self.assertEqual(result['first_quantity'],10)
        self.assertEqual(content,before)

    def test_public_check_contains_only_ciphertext_decryptable_by_requester(self):
        real_run=subprocess.run
        with tempfile.TemporaryDirectory() as directory:
            private=str(Path(directory)/'private.pem');cert=str(Path(directory)/'cert.pem')
            real_run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-subj','/CN=Synthetic audit','-days','1','-keyout',private,'-out',cert],check=True,capture_output=True)
            payload={'total_formula':'synthetic-private-formula','total_comment':'synthetic-private-comment'}
            calls=[]
            def run(args,**kwargs):
                if args[0]=='openssl':return real_run(args,**kwargs)
                calls.append(kwargs);return Mock(returncode=0)
            env={'DIAGNOSTIC_CERTIFICATE':base64.b64encode(Path(cert).read_bytes()).decode(),'GITHUB_SHA':'fixture','GITHUB_REPOSITORY':'SahandFAME/portfolio-agent-telegram','PRIVATE_AUDIT_CHECK_TOKEN':'fixture-check-token'}
            with patch.dict(os.environ,env,clear=True),patch.object(inspector,'graph_token',return_value='fixture'),patch.object(inspector,'download_workbook',return_value=(b'fixture','fixture')),patch.object(inspector,'inspect',return_value=payload),patch.object(inspector.subprocess,'run',side_effect=run):
                self.assertTrue(inspector.run()['encrypted_diagnostic_published'])
            body=json.loads(calls[0]['input']);encrypted=base64.b64decode(body['output']['summary'])
            self.assertNotIn('synthetic-private',json.dumps(body))
            decrypted=real_run(['openssl','cms','-decrypt','-binary','-inform','DER','-recip',cert,'-inkey',private],input=encrypted,capture_output=True,check=True).stdout
            self.assertEqual(json.loads(decrypted),payload)


if __name__=='__main__':unittest.main()
