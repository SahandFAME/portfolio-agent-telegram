# Independent read-only OneDrive verification

## Reauthorization after export consent

The source reader and report exporter currently share a Microsoft app registration
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
