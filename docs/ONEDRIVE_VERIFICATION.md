# Independent read-only OneDrive verification

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
