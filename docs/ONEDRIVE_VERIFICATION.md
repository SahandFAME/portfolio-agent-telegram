# Independent read-only OneDrive verification

## Reauthorization after export consent

The source reader and report exporter previously shared a Microsoft app registration
with separate refresh-token secrets. Personal-account device sign-in can return
the previously consented `Files.ReadWrite` scope even for a read-only request.
`authorize_microsoft.py` now exchanges such a result with an explicit `Files.Read`
refresh request and requires a returned access token with verified read-only
scopes before saving the source secret. It never uses the broad token for Graph
or changes the exporter secret. Every source-worker refresh independently requests
`Files.Read` and continues to reject write scopes. This narrows access tokens; it
does not revoke the app's existing export grant or make its refresh token incapable
of requesting other already-consented scopes.

If narrowing fails or still returns write permission, consent fails closed; a
separate read-only app registration may be required. A successful sign-in alone
does not prove live workbook access: rerun the sync and verify exact readback.
Unit tests cover narrowing, rotated-token persistence, rejected write scopes,
missing/invalid responses, unchanged export behavior and absence of secret logs.

## Dedicated reader app (2026-11-12)

Explicit narrowing still returned write scope in the owner's real sign-in. The
owner created reader app `dbff9cdd-2ee1-489b-ac50-71a2021b18e2`, requesting only
delegated Files.Read with public client flows enabled. Bot dispatch, scheduled
history reads, audit reads and manual reader defaults now use this app. Source
consent still saves only `MS_GRAPH_REFRESH_TOKEN`; it requires fresh owner sign-in.

The exporter stays on `04a73ec3-340a-4cb6-a087-7fdc4dfd93e0` with
`MS_GRAPH_EXPORT_REFRESH_TOKEN`. Never revoke that app or change its credential
as part of source recovery. The consent workflow selects an app by purpose when
client_id is empty. Override stale cloud `MS_GRAPH_CLIENT_ID` settings with the
reader ID for source operations; exporter operations must use the export app.
Configuration alone does not establish restored access. Confirm successful
consent, then all 23 quantities and exact production readback before reporting
recovery or completing any valuation based on fresh quantities.

## HTTP failure diagnostics

Do not infer expired Microsoft consent from a generic `http_401`. Source sync now
prefixes HTTP codes with `production_prior_read`, `microsoft_token`,
`graph_metadata`, `graph_download_url`, `workbook_download` or `graph_recheck`
as applicable. These labels contain no response bodies, URLs, identity fields or
tokens. Existing validation errors remain unchanged. Diagnose the failing stage
before requesting a new sign-in; successful consent alone does not prove Graph
file retrieval or production readback.

If the metadata download URL returns 401, the reader requests a new redirect from
the same item's Graph `/content` endpoint once. Automatic redirects are disabled
on that authenticated request. Only an HTTPS URL without embedded credentials is
accepted, and its download carries no Graph Authorization header. The original
workbook identity and before/after eTag checks still apply. Graph-content failures
and fresh-download failures remain distinct errors; no workbook writes occur.

Live verification on 2026-11-13: dedicated-reader consent succeeded. Source sync
passed prior production read, token refresh and Graph metadata lookup, but failed
at `workbook_download_http_401`. A fresh `/content` redirect was also rejected at
`fresh_workbook_download_http_401`. Recovery is not verified. Do not describe this
as token expiry, retry consent as the default remedy or substitute the old cache.
Check normal owner-session file download and investigate file delivery separately.

Microsoft personal-account consent completed successfully on 2026-10-10.
The refresh token is stored only in the repository Actions secret
`MS_GRAPH_REFRESH_TOKEN`. The dedicated secret-writer credential is proven
usable inside GitHub Actions; the Codex GitHub proxy does not expose that same
Secrets API access.

Run **Verify live OneDrive quantities (read only)** manually on `main`, supplying
the Microsoft application's public client ID. There is no schedule. The workflow
refreshes delegated authorization and securely persists any rotated refresh token,
verifies workbook identity and an unchanged eTag around the download, then checks
all 23 configured named tables and their explicit cached quantity totals. It never
sums transaction history, saves the workbook, sends production sync requests. If the repository secret
`PORTFOLIO_SYNC_SECRET_AGENT` is configured, it also performs an authenticated
GET of the production cache and reports whether all 23 fresh quantities match.
Otherwise it reports this precise missing prerequisite without losing the
successful workbook verification. Missing or ambiguous totals fail closed.

Only counts, a source modification timestamp, and fixed error codes are logged.
The `onedrive/read-only` commit status records the safe aggregate result for
operational inspection when cloud access to Actions logs is unavailable.

Passing this check establishes fresh workbook access and extraction only.
Production comparison, Telegram command verification, monitoring, a verified
scheduled replacement, and the owner's migration approval remain separate gates.
Keep the existing bot and ChatGPT automation running throughout verification.
