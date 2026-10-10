"""One-time personal Microsoft consent, executed outside the Codex GitHub proxy.

Tokens go directly to GitHub repository secrets through gh stdin. Only Microsoft's
temporary user sign-in code is displayed. No workbook is read or written.
"""
import json
import os
import subprocess
import time
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


def authorize():
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
                     'scope':'https://graph.microsoft.com/Files.Read offline_access'})
    if not all(response.get(k) for k in ('device_code','user_code','expires_in')):
        raise ConsentError('microsoft_device_signin_unavailable')
    print('Open https://microsoft.com/devicelogin', flush=True)
    print('Enter this temporary sign-in code:',response['user_code'],flush=True)
    print('Sign in with the personal Microsoft account holding Trading Journal.xlsm.',flush=True)
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
        if 'files.readwrite' in result.get('scope','').lower():
            raise ConsentError('unexpected_write_scope')
        outcome = subprocess.run(['gh','secret','set','MS_GRAPH_REFRESH_TOKEN','--repo',repo],
                                 input=result['refresh_token'].encode(),
                                 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if outcome.returncode:
            raise ConsentError('refresh_token_storage_failed')
        print('Microsoft consent completed; MS_GRAPH_REFRESH_TOKEN saved securely.',flush=True)
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
