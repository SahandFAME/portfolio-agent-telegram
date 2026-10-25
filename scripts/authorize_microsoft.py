"""One-time personal Microsoft consent, executed outside the Codex GitHub proxy.

Tokens go directly to GitHub repository secrets through gh stdin. Only Microsoft's
temporary user sign-in code is displayed. No workbook is read or written.
"""
import base64
import json
import os
import subprocess
import time
import tempfile
from urllib import error, parse, request
import uuid


class ConsentError(Exception):
    pass


def required(name):
    value = os.environ.get(name)
    if not value:
        raise ConsentError('missing_' + name)
    return value


def oauth(action, fields):
    req = request.Request('https://login.microsoftonline.com/consumers/oauth2/v2.0/' + action,
                          data=parse.urlencode(fields).encode(),
                          headers={'Content-Type':'application/x-www-form-urlencoded'})
    try:
        with request.urlopen(req, timeout=30) as response:
            return json.loads(response.read(65536))
    except error.HTTPError as exc:
        if exc.code in (400, 401):
            try:
                return json.loads(exc.read(65536))
            finally:
                exc.close()
        raise ConsentError('microsoft_http_failure') from None


def publish_private_signin(response):
    """Only encrypted user instructions enter this public repository's checks."""
    try:
        key=base64.b64decode(required('MICROSOFT_SIGNIN_PUBLIC_KEY'),validate=True)
        if len(key)>4096 or b'BEGIN PUBLIC KEY' not in key:raise ValueError()
    except ValueError:raise ConsentError('invalid_signin_public_key') from None
    payload=json.dumps({k:response[k] for k in ('user_code','verification_uri','expires_in')}).encode()
    with tempfile.NamedTemporaryFile() as file:
        file.write(key);file.flush()
        encrypted=subprocess.run(['openssl','pkeyutl','-encrypt','-pubin','-inkey',file.name,
            '-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256'],input=payload,capture_output=True)
    if encrypted.returncode:raise ConsentError('signin_encryption_failed')
    body={'name':'Private Microsoft report sign-in','head_sha':required('GITHUB_SHA'),'status':'completed','conclusion':'success',
          'output':{'title':'Encrypted sign-in instructions for the requesting Codex session',
                    'summary':base64.b64encode(encrypted.stdout).decode()}}
    env={**os.environ,'GH_TOKEN':required('CONSENT_CHECK_TOKEN')}
    result=subprocess.run(['gh','api','--method','POST','repos/'+required('GITHUB_REPOSITORY')+'/check-runs','--input','-'],
        input=json.dumps(body).encode(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env)
    if result.returncode:raise ConsentError('signin_instructions_unavailable')
    print('Private Microsoft sign-in instructions encrypted for the requesting Codex session. No sign-in code is printed in public logs.',flush=True)


def authorize():
    purpose = os.environ.get('MICROSOFT_CONSENT_PURPOSE', 'read_only')
    if purpose not in ('read_only', 'report_export'):
        raise ConsentError('invalid_consent_purpose')
    export = purpose == 'report_export'
    if export:
        required('MICROSOFT_SIGNIN_PUBLIC_KEY');required('CONSENT_CHECK_TOKEN');required('GITHUB_SHA')
    permission = 'Files.ReadWrite' if export else 'Files.Read'
    secret = 'MS_GRAPH_EXPORT_REFRESH_TOKEN' if export else 'MS_GRAPH_REFRESH_TOKEN'
    client = required('MS_GRAPH_CLIENT_ID').strip()
    try:
        uuid.UUID(client)
    except ValueError:
        raise ConsentError('invalid_client_id') from None
    required('GH_TOKEN')
    repo = required('GITHUB_REPOSITORY')
    if repo != 'SahandFAME/portfolio-agent-telegram':
        raise ConsentError('unexpected_repository')
    # Validate the actual runner credential before asking the owner to sign in.
    status = subprocess.run(['gh','api',f'repos/{repo}/actions/secrets/public-key'],
                            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if status.returncode:
        raise ConsentError('github_secret_access_denied')
    response = oauth('devicecode', {'client_id':client,
                     'scope':'https://graph.microsoft.com/' + permission + ' offline_access'})
    if not all(response.get(k) for k in ('device_code','user_code','verification_uri','expires_in')):
        raise ConsentError('microsoft_device_signin_unavailable')
    uri = response['verification_uri']
    # Personal-account codes currently use microsoft.com/link; work/school
    # codes can use devicelogin. Honor the authoritative OAuth response.
    if uri not in ('https://www.microsoft.com/link', 'https://microsoft.com/devicelogin',
                   'https://www.microsoft.com/devicelogin'):
        raise ConsentError('unexpected_microsoft_signin_address')
    if export:publish_private_signin(response)
    else:
        print('Open ' + uri, flush=True)
        print('Enter this temporary sign-in code:',response['user_code'],flush=True)
    print('Sign in with the personal Microsoft account holding Trading Journal.xlsm.',flush=True)
    if export:
        print('Approve OneDrive file read/write access for the separate report exporter. Microsoft grants access to your files; the exporter only writes Portfolio-18K-Gold-History.xlsx inside اسناد.',flush=True)
        print('Trading Journal.xlsm remains read-only and the existing sync connection is preserved.',flush=True)
    else:
        print('Review the read-only file access consent. No workbook write permission is requested.',flush=True)
    delay = max(5, int(response.get('interval',5)))
    deadline = time.monotonic() + min(int(response['expires_in']), 900)
    while time.monotonic() < deadline:
        time.sleep(min(delay,60))
        result = oauth('token', {'client_id':client,
                       'grant_type':'urn:ietf:params:oauth:grant-type:device_code',
                       'device_code':response['device_code']})
        if result.get('error') == 'authorization_pending':
            continue
        if result.get('error') == 'slow_down':
            delay += 5
            continue
        if not result.get('refresh_token'):
            raise ConsentError('microsoft_consent_denied_or_failed')
        scopes = {s.rsplit('/',1)[-1].lower() for s in result.get('scope','').split()}
        if export and 'files.readwrite' not in scopes:
            raise ConsentError('report_write_scope_missing')
        if not export and 'files.readwrite' in result.get('scope','').lower():
            raise ConsentError('unexpected_write_scope')
        outcome = subprocess.run(['gh','secret','set',secret,'--repo',repo],
                                 input=result['refresh_token'].encode(),
                                 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if outcome.returncode:
            raise ConsentError('refresh_token_storage_failed')
        print('Microsoft consent completed; ' + secret + ' saved securely.',flush=True)
        return
    raise ConsentError('microsoft_consent_expired')


def main():
    try:
        authorize()
        return 0
    except ConsentError as exc:
        print(json.dumps({'ok':False,'error':str(exc)}))
        return 1
    except Exception:
        print(json.dumps({'ok':False,'error':'consent_unavailable'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
