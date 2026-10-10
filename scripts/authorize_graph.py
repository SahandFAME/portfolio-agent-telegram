"""Interactive Microsoft consent; token goes directly to a repository secret.

Run only after the owner creates/chooses the dedicated personal-account public
client app and grants secure GitHub Secrets-write access. No token files/logs.
"""
import json
import os
import subprocess
import time
from urllib import error, parse, request

from portfolio_sync import SyncError, required


def post(action, fields):
    req = request.Request('https://login.microsoftonline.com/consumers/oauth2/v2.0/' + action,
                          data=parse.urlencode(fields).encode(),
                          headers={'Content-Type':'application/x-www-form-urlencoded'})
    try:
        with request.urlopen(req, timeout=30) as response:
            return json.loads(response.read(65536))
    except error.HTTPError as exc:
        # OAuth polling error codes only; never log descriptions or token responses.
        if exc.code == 400:
            try:
                return json.loads(exc.read(65536))
            finally:
                exc.close()
        raise SyncError('consent_http_failure') from None


def main():
    try:
        client = required('MS_GRAPH_CLIENT_ID')
        required('GH_TOKEN')
        repo = required('GITHUB_REPOSITORY')
        response = post('devicecode', {'client_id':client,
                        'scope':'https://graph.microsoft.com/Files.Read offline_access'})
        if not all(response.get(k) for k in ('device_code','user_code','verification_uri','expires_in')):
            raise SyncError('device_consent_unavailable')
        # This deliberately displays Microsoft's user-facing sign-in code, never
        # the device_code, refresh token, access token, or credential values.
        print('Read-only Microsoft consent: open https://microsoft.com/devicelogin')
        print('Enter this temporary sign-in code:', response['user_code'])
        interval = max(5, int(response.get('interval',5)))
        deadline = time.monotonic() + int(response['expires_in'])
        while time.monotonic() < deadline:
            time.sleep(min(interval,60))
            result = post('token', {'client_id':client,
                          'grant_type':'urn:ietf:params:oauth:grant-type:device_code',
                          'device_code':response['device_code']})
            if result.get('error') == 'authorization_pending':
                continue
            if result.get('error') == 'slow_down':
                interval += 5
                continue
            if not result.get('refresh_token'):
                raise SyncError('consent_failed_or_denied')
            status = subprocess.run(['gh','secret','set','MS_GRAPH_REFRESH_TOKEN','--repo',repo],
                                    input=result['refresh_token'].encode(),
                                    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if status.returncode:
                raise SyncError('consent_secret_persistence_failed')
            print('Microsoft consent completed; refresh token securely stored as repository secret.')
            return 0
        raise SyncError('consent_expired')
    except SyncError as exc:
        print(json.dumps({'ok':False,'error':str(exc)}))
        return 1
    except Exception:
        print(json.dumps({'ok':False,'error':'consent_unavailable'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
