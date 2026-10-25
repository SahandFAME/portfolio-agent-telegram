import base64
from io import BytesIO
import hashlib
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock,patch

from openpyxl import Workbook
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import upload_gold_history as upload


def workbook(marker=upload.IDENTIFIER,value=1):
    book=Workbook();book.remove(book.active)
    for name in ['ارزش هفتگی','دارایی‌ها','ترکیب دارایی','موارد نیازمند بررسی','خلاصه تحلیل']:book.create_sheet(name)
    book.properties.identifier=marker;book.worksheets[0]['A1']=value
    stream=BytesIO();book.save(stream);return stream.getvalue()


class ReportUploadTests(unittest.TestCase):
    def setUp(self):
        self.data=workbook()
        self.report={'content_base64':base64.b64encode(self.data).decode(),'sha256':hashlib.sha256(self.data).hexdigest(),'revision':'rev1'}
        self.folder={'id':'FOLDER','name':upload.FOLDER,'folder':{},'parentReference':{'driveId':upload.DRIVE}}
        self.item={'id':'REPORT','name':upload.FILENAME,'eTag':'"version1"','file':{},'parentReference':{'id':'FOLDER','driveId':upload.DRIVE}}
        self.metadata={**self.item,'@microsoft.graph.downloadUrl':'https://download.example.invalid/report'}

    def run_upload(self,responses,download=None):
        api=patch.object(upload,'api',side_effect=[self.report,{'revision':'rev1'},{'revision':'rev1'}])
        token=patch.object(upload,'export_token',return_value='synthetic-access-secret')
        with api,token,patch.object(upload,'json_request',side_effect=responses) as graph,patch.object(upload,'http',return_value=self.data if download is None else download) as http:
            result=upload.upload_report()
            return result,graph.call_args_list,http.call_args_list

    def test_new_report_is_the_only_write_and_downloaded_bytes_match(self):
        result,calls,downloads=self.run_upload([{'id':upload.DRIVE},self.folder,upload.SyncError('http_404'),self.item,self.metadata])
        writes=[c for c in calls if c.kwargs.get('method')=='PUT']
        self.assertEqual(len(writes),1);self.assertIn('/items/FOLDER:/'+upload.FILENAME+':/content',writes[0].args[0])
        self.assertIn('conflictBehavior=fail',writes[0].args[0]);self.assertEqual(writes[0].kwargs['headers']['If-None-Match'],'*')
        self.assertEqual(writes[0].kwargs['retries'],0)
        self.assertEqual(writes[0].kwargs['body'],self.data)
        self.assertNotIn('Trading',writes[0].args[0]);self.assertTrue(result['onedrive_hash_verified'])
        self.assertEqual(downloads[0].kwargs,{})

    def test_existing_generated_report_uses_conditional_update(self):
        old=workbook(value=2)
        with patch.object(upload,'api',side_effect=[self.report,{'revision':'rev1'},{'revision':'rev1'}]),patch.object(upload,'export_token',return_value='fixture'),patch.object(upload,'json_request',side_effect=[{'id':upload.DRIVE},self.folder,self.item,self.metadata,self.item,self.metadata]) as graph,patch.object(upload,'http',side_effect=[old,self.data]):
            self.assertTrue(upload.upload_report()['ok'])
        write=[c for c in graph.call_args_list if c.kwargs.get('method')=='PUT'][0]
        self.assertEqual(write.args[0],upload.GRAPH+'/drives/'+upload.DRIVE+'/items/REPORT/content')
        self.assertEqual(write.kwargs['headers']['If-Match'],'"version1"')

    def test_same_report_is_verified_without_rewriting(self):
        _,calls,_=self.run_upload([{'id':upload.DRIVE},self.folder,self.item,self.metadata,self.metadata])
        self.assertFalse(any(c.kwargs.get('method')=='PUT' for c in calls))

    def test_wrong_account_or_folder_never_writes(self):
        for responses in [[{'id':'other-account'}],[{'id':upload.DRIVE},{**self.folder,'name':'other-folder'}]]:
            with self.subTest(responses=responses),patch.object(upload,'api',return_value=self.report),patch.object(upload,'export_token',return_value='fixture'),patch.object(upload,'json_request',side_effect=responses) as graph:
                with self.assertRaises(upload.SyncError):upload.upload_report()
                self.assertFalse(any(c.kwargs.get('method')=='PUT' for c in graph.call_args_list))

    def test_unrelated_workbook_collision_is_not_overwritten(self):
        with self.assertRaisesRegex(upload.SyncError,'report_identity_not_verified'):
            self.run_upload([{'id':upload.DRIVE},self.folder,self.item,self.metadata],workbook(marker='unrelated workbook'))

    def test_source_item_id_is_always_rejected_even_if_renamed(self):
        with self.assertRaisesRegex(upload.SyncError,'report_destination_not_verified'):
            self.run_upload([{'id':upload.DRIVE},self.folder,{**self.item,'id':upload.SOURCE_ITEM}])

    def test_hash_mismatch_is_not_reported_as_success(self):
        with self.assertRaisesRegex(upload.SyncError,'onedrive_report_readback_mismatch'):
            self.run_upload([{'id':upload.DRIVE},self.folder,upload.SyncError('http_404'),self.item,self.metadata],workbook(value=3))

    def test_changed_revision_prevents_stale_upload(self):
        with patch.object(upload,'api',side_effect=[self.report,{'revision':'newer'}]),patch.object(upload,'export_token',return_value='fixture'),patch.object(upload,'json_request',side_effect=[{'id':upload.DRIVE},self.folder,upload.SyncError('http_404')]) as graph:
            with self.assertRaisesRegex(upload.SyncError,'revision_changed_before'):upload.upload_report()
            self.assertFalse(any(c.kwargs.get('method')=='PUT' for c in graph.call_args_list))

    def test_concurrent_edit_is_not_retried_or_overwritten(self):
        with patch.object(upload,'api',side_effect=[self.report,{'revision':'rev1'}]),patch.object(upload,'export_token',return_value='fixture'),patch.object(upload,'json_request',side_effect=[{'id':upload.DRIVE},self.folder,self.item,self.metadata,upload.SyncError('http_412')]) as graph,patch.object(upload,'http',return_value=workbook(value=2)):
            with self.assertRaisesRegex(upload.SyncError,'http_412'):upload.upload_report()
            self.assertEqual(len([c for c in graph.call_args_list if c.kwargs.get('method')=='PUT']),1)

    def test_rotated_write_token_is_saved_in_separate_secret(self):
        env={'MS_GRAPH_CLIENT_ID':'fixture','MS_GRAPH_EXPORT_REFRESH_TOKEN':'write-refresh-secret','GH_TOKEN':'secret-writer','GITHUB_REPOSITORY':'SahandFAME/portfolio-agent-telegram'}
        with patch.dict(os.environ,env,clear=True),patch.object(upload,'json_request',return_value={'scope':'Files.ReadWrite','access_token':'fixture','refresh_token':'rotated-write-secret'}) as token,patch.object(upload.subprocess,'run',return_value=Mock(returncode=0)) as run:
            self.assertEqual(upload.export_token(),'fixture')
            self.assertIn('MS_GRAPH_EXPORT_REFRESH_TOKEN',run.call_args.args[0]);self.assertNotIn('MS_GRAPH_REFRESH_TOKEN',run.call_args.args[0])
            self.assertEqual(run.call_args.kwargs['input'],b'rotated-write-secret')
            self.assertIn(b'Files.ReadWrite',token.call_args.kwargs['body'])

    def test_read_only_token_cannot_silently_skip_upload(self):
        with patch.dict(os.environ,{'MS_GRAPH_CLIENT_ID':'fixture','MS_GRAPH_EXPORT_REFRESH_TOKEN':'fixture'},clear=True),patch.object(upload,'json_request',return_value={'scope':'Files.Read','access_token':'fixture'}):
            with self.assertRaisesRegex(upload.SyncError,'report_write_scope_missing'):upload.export_token()


if __name__=='__main__':unittest.main()
