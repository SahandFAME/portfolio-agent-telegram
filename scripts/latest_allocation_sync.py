"""Authorized on-demand sync; no scheduling, financial logs or workbook writes."""
import json
import os
from pathlib import Path
import uuid
from datetime import datetime, timezone

from verify_onedrive import (SyncError, required, graph_token, download_workbook,
                            extract_quantities, read_snapshot, json_request, iso,
                            utcnow, validate_assets)

ENDPOINT = 'https://portfolio-agent-telegram.vercel.app/api/telegram'


def synchronize():
    if os.environ.get('PORTFOLIO_ONDEMAND_ENABLED') != 'true':
        raise SyncError('on_demand_sync_disabled')
    secret = required('PORTFOLIO_SYNC_SECRET_AGENT')
    previous = read_snapshot(ENDPOINT, secret)  # Unreadable prior state blocks writes.
    content, modified = download_workbook(graph_token())
    assets = extract_quantities(content)
    validate_assets(assets)
    if iso(modified) < iso(previous.get('workbook_updated_at') or previous['updated_at']):
        raise SyncError('older_workbook_rejected')
    if iso(modified) > datetime.now(timezone.utc):
        raise SyncError('future_workbook_rejected')
    payload = {'version': 'Latest Allocation verified OneDrive table totals',
               'updated_at': utcnow(), 'workbook_updated_at': modified, 'assets': assets}
    response = json_request(ENDPOINT + '?sync=portfolio', method='POST',
                            headers={'x-portfolio-sync-secret': secret, 'Content-Type': 'application/json'},
                            body=json.dumps(payload, allow_nan=False).encode(), retries=0, redirect=False)
    if response.get('ok') is not True or response.get('stored') is not True or response.get('received') != 23:
        raise SyncError('production_sync_not_confirmed')
    readback = read_snapshot(ENDPOINT, secret)
    for key in ('assets', 'updated_at', 'workbook_updated_at'):
        if readback.get(key) != payload[key]:
            raise SyncError('production_readback_mismatch')
    return {'ok': True, 'verified_assets': 23, 'readback_verified': True,
            'snapshot_updated_at': payload['updated_at'], 'workbook_updated_at': modified}


def notify(request_id, result):
    # Completion body never contains holdings, chat IDs, prices or OAuth tokens.
    response = json_request(ENDPOINT + '?complete=latest-allocation', method='POST',
                            headers={'x-portfolio-sync-secret': required('PORTFOLIO_SYNC_SECRET_AGENT'),
                                     'Content-Type': 'application/json'},
                            body=json.dumps({'request_id': request_id, **result}).encode(),
                            retries=0, redirect=False)
    if response.get('ok') is not True:
        raise SyncError('bot_completion_not_accepted')


def main():
    request_id = os.environ.get('ALLOCATION_REQUEST_ID', '').strip()
    try:
        if request_id:
            try:
                if str(uuid.UUID(request_id)) != request_id:
                    raise ValueError()
            except ValueError:
                raise SyncError('invalid_request_id') from None
        result = synchronize()
    except SyncError as exc:
        result = {'ok': False, 'error': str(exc)}
    except Exception:
        result = {'ok': False, 'error': 'unexpected_sync_failure'}
    if request_id and result.get('error') != 'invalid_request_id':
        try:
            notify(request_id, result)
        except Exception:
            result = {**result, 'ok': False, 'error': 'bot_completion_failed'}
    Path('latest-allocation-result.json').write_text(json.dumps(result))
    print(json.dumps(result))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
