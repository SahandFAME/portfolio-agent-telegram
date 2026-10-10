# Operational ownership and migration

Read AGENTS.md, CODEX_HANDOFF.md and [Issue #1](https://github.com/SahandFAME/portfolio-agent-telegram/issues/1) first. The existing bot, private Blob cache, price providers and Telegram access controls are retained. Development changes are pushed to `codex/operational-ownership` for review; no merge, production promotion or migration was performed. The Trading Journal workbook is always read-only. No private workbook or credentials belong in this repository.

Codex tasks maintain this repository and prepare operations changes. A Codex chat is not a permanent worker or scheduler. GitHub Actions will execute independent jobs after configuration and explicit activation.

## Verified evidence and limits

Audit date: 2026-10-10, Asia/Tehran.

| Capability | Evidence | Current limit |
|---|---|---|
| Source and handoff | Read AGENTS.md, CODEX_HANDOFF.md and complete Issue #1 body through GitHub web page | GitHub API calls received Forbidden |
| Git read/write | `git ls-remote origin HEAD` succeeded, main at `1cbba41e83df55f58e8ea5632273299beff7b6d6`; ownership branch push succeeded | Actions/settings/secret permissions not established |
| Local bot | Regression tests execute the actual source with mocked Blob/Telegram/market services; real Persian font/PNG rendering | Does not prove live quotes, private Blob or Telegram commands |
| Production HTTP | Attempted health and protected readback | Proxy rejected the production host with 403 before reaching the application |
| Vercel operations | Project identifiers available in handoff | No Vercel credential binding or callable connector; deployment state/logs not verified |
| Microsoft Graph | Personal OneDrive confirmed by owner | Dedicated app/consent not supplied; actual table layout/cached totals not inspected |
| Independent sync/monitor | Implementation and workflows pushed to review branch; 26 Node and 19 Python tests passed with no skips or TODOs | Not scheduled or run live; CI has not been observed on GitHub |
| ChatGPT sync | Historical handoff says daily 09:00 Tehran from October 11 | No scheduler management access or verified recurring run; left untouched |

The handoff's October 10 authenticated production sync is historical evidence, not a new live verification. No holdings are described as current in this audit.

## Source findings and prepared fixes

Six reproduced issues are fixed locally and covered by regression tests:

- Shared TGJU melted-gold quote was mutated on conversion, dividing one holding's quote by 4.6083 a second time. Each holding now receives an independent converted object.
- Sync used `Number(value)`, accepting booleans/null/numeric strings. It now requires actual finite, nonnegative JSON numbers.
- `assets: null` threw outside the storage error handler. It now receives HTTP 400.
- A failed cache read was treated as absent state, permitting an overwrite. It now fails closed with HTTP 500.
- Message splitting used literal `\\n`, permitting oversized Telegram requests, and indexed a three-item preformatted report as though it had four items. It now uses actual newlines, correct prefix/body/footer extraction, and bounded chunks, including long single lines.
- Missing webhook authentication configuration accepted unauthenticated POSTs. It now fails closed with HTTP 503.

Remaining review items, without claiming production repair: concurrent Blob read/overwrite races (no compare-and-swap), future sync timestamps accepted by the existing API, old unused allocation helper capable of partial totals, instrument identity and silver certificate/gram basis, quote-provider trade timestamps versus fetch timestamps, network timeouts, swallowed outbound Telegram errors, and access-state read/modify/write races. The new sender rejects future workbook timestamps and never bypasses invalid prior state. Real price availability and units require separate live verification.

## Required owner actions

The personal Microsoft account and choice to use GitHub Actions are settled. Supply authorizations through service/environment settings, never in chat:

1. **Microsoft:** create or select a dedicated Microsoft app accepting personal accounts; enable its public-client/device-code flow. Grant delegated `Files.Read` and `offline_access`. No workbook writes or `Files.ReadWrite` permission. `Files.Read` permits reading the signed-in account's files; it is not technically limited to one workbook. The implementation only requests the configured file. App-only/client-secret authentication is not suitable for this personal account. If broader account read permission is unacceptable, choose a different service with an explicitly supported narrower authorization method before activation.
2. **GitHub:** allow this repository's Actions and give the maintainer access to branches/PRs, workflows, run logs, settings and secrets. A dedicated fine-grained credential restricted to this repo needs **Secrets: write** for refresh-token rotation; store it as `PORTFOLIO_SECRET_WRITER_TOKEN`. Standard Actions `GITHUB_TOKEN` cannot update repository secrets. Do not use a full-account PAT. Ensure Actions failure notifications are enabled for the owner. API network access must work before inferring that existing GitHub authorization is missing.
3. **Vercel:** grant access to the existing project for deployment inspection, logs, environment settings and preview deployments. Bind `VERCEL_TOKEN` securely or provide an authorized connector. Make the existing secondary `PORTFOLIO_SYNC_SECRET_AGENT` available to the independent reader; do not rotate the original sender secret. A preview must use isolated Blob/auth configuration and must not share writable production storage. Do not blindly pull production secrets into a logged command.
4. **Telegram:** securely bind the current bot token for read-only `getMe`/`getWebhookInfo`; identify an authorized private verification/alert chat and approve test messages. The owner can send real slash commands from that chat; a bot API credential cannot impersonate a human Telegram user. No webhook change is needed for inspection.
5. **Network:** review the saved explicit domains for GitHub API, Vercel, production, Microsoft Graph/auth, Telegram and price providers. After authenticated metadata discovery, add the exact OneDrive download hostname returned by Graph; it cannot be derived safely from the item ID alone. Preserve existing allowed domains and verification. Cloud environment settings and GitHub Actions environment/secrets are separate configurations.

The saved cloud draft declares missing service bindings and nonsecret identifiers; it does not grant permissions, create OAuth consent, populate GitHub Actions secrets, execute jobs or publish anything. Review and save changes in environment settings, then publish the environment. Access held by ChatGPT's OneDrive connector is not inherited by GitHub Actions or Codex.

## Secure consent and configuration

`scripts/authorize_graph.py` implements the Microsoft device-code flow. Run it interactively after app creation, with secure `MS_GRAPH_CLIENT_ID`, `GH_TOKEN` (the dedicated Secrets-write credential) and `GITHUB_REPOSITORY` bindings. It displays only the short-lived Microsoft user sign-in code and official verification address. The owner signs in and reviews permission consent in Microsoft's browser flow. It stores the refresh token directly via `gh secret set` stdin, with command output suppressed; no token file is written. Do not run this script inside an unattended workflow.

The following GitHub **repository** secrets must be set securely:

| Secret | Use |
|---|---|
| `MS_GRAPH_REFRESH_TOKEN` | Established by Microsoft consent; updated after each rotation |
| `PORTFOLIO_SECRET_WRITER_TOKEN` | Fine-grained Secrets-write credential, restricted to this repo |
| `PORTFOLIO_SYNC_SECRET_AGENT` | Existing secondary production sync header credential |
| `TELEGRAM_BOT_TOKEN` | Optional read-only identity/webhook inspection |

Keep `MS_GRAPH_REFRESH_TOKEN` at repository scope: the rotation command updates a repository secret. An environment secret of the same name would shadow the updated value and break persistence. Repository workflows and PRs able to use these secrets are a trust boundary; protect main and review workflow changes. A compromised repository Secrets-write credential could replace secrets. Prefer a dedicated automation identity with expiry and a documented owner. A public-client app does not need `MS_GRAPH_CLIENT_SECRET`.

Repository variables:

| Variable | Value/purpose |
|---|---|
| `MS_GRAPH_CLIENT_ID` | Dedicated personal-account app ID |
| `MS_GRAPH_DRIVE_ID` | Verify handoff identifier `daef687b3c624f3` against authorized live metadata |
| `MS_GRAPH_ITEM_ID` | Verify handoff identifier `DAEF687B3C624F3!2063` against authorized live metadata |
| `PORTFOLIO_ENDPOINT` | `https://portfolio-agent-telegram.vercel.app/api/telegram` |
| `PORTFOLIO_MIGRATION_APPROVED` | `false`; change only after explicit owner approval |

Create `portfolio-readonly` and `portfolio-production` GitHub environments. Require owner approval for production-write jobs. Deny self-approval and restrict deployment branches where the repository's plan supports these protections. Use the readonly environment for comparison/monitor jobs so they can later run unattended. Initially the workflow is manual-only, with no cron trigger. Settings must be reviewed before any workflow receives real credentials.

## Local validation

Use the existing checkout; no worktree is needed. Node 24 and Python 3.12+ are the intended runtimes.

```sh
cd /workspace/portfolio-agent-telegram
npm ci --no-audit --no-fund
python -m venv /workspace/portfolio-sync-venv
/workspace/portfolio-sync-venv/bin/python -m pip install -r scripts/requirements-sync.txt
npm test
/workspace/portfolio-sync-venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

The tests generate synthetic in-memory workbooks, with deliberately misleading transaction rows and explicit cached total rows. They do not retrieve or save the real workbook, send Telegram messages, or contact production. VM module flags are confined to Node's test runner.

## Independent sync behavior

`python scripts/portfolio_sync.py` is **read-only comparison by default**. It refreshes Graph consent and persists the new refresh token securely, downloads the configured workbook into memory without forwarding the Graph bearer token to the file host, checks eTag stability, reads the exact 23 named tables and columns, and compares with the authenticated cache. Logs show counts/match status, never holdings or credential values.

An explicitly declared Excel totals row and cached numeric total are required. There is no transaction-summing, arbitrary-last-row or Excel-formula-execution fallback. Missing formula caches, totals metadata, tables or numeric balances fail closed. If the actual workbook uses another current-balance layout, inspect it read-only and add a reviewed extraction rule; do not modify or recalculate the source workbook to make the extractor pass.

`--write` additionally requires `PORTFOLIO_MIGRATION_APPROVED=true`. It validates existing cache state, rejects older source timestamps, sends exactly 23 workbook assets, requires `ok:true, received:23, stored:true`, and reads back all 23 balances and both timestamps exactly. The six manual holdings never enter the payload. GET/OAuth requests have bounded retries/timeouts; a timed-out POST is ambiguous and is not blindly repeated. In that event, inspect authenticated readback and re-fetch the workbook before deciding what to retry.

`--monitor` verifies application health, complete private snapshot and sync freshness. It separately reports workbook edit age: an unchanged workbook can legitimately have an old edit timestamp while today's verified read is fresh. `--telegram` checks bot identity and configured webhook with read-only Bot API calls; it does not prove a human command was delivered or replied to. Neither command provides deployment-log or price-provider verification yet.

## Verification and cutover sequence

1. Complete required access and run the manual read-only comparison against the live workbook and cache. Inspect any ambiguous totals without editing the workbook.
2. Publish code through a reviewed PR and verify CI. Deploy a Vercel preview with an isolated private Blob store. Exercise authenticated writes/readback, invalid/old payloads, unchanged workbook, zero balances and all six preserved manual assets there. Keep production unchanged.
3. Activate a temporary **read-only scheduled comparison** on GitHub Actions and verify actual runs occur independently of ChatGPT, including token rotation and failure notifications. Use `30 5 * * *` for approximately 09:00 Tehran (UTC+03:30); GitHub may delay scheduled jobs. Scheduled workflows execute from the default branch. Include an hourly read-only monitor, allowing for scheduler delays around the 24-hour staleness cutoff.
4. With authorized production access, inspect deployed commit/state/logs and read the private snapshot. Have the owner send `/status`, `/assets`, `/gold`, `/crypto`, `/cash`, `/allocation`, `/refresh` from the approved private Telegram chat. Verify replies, stale/missing-price handling, and each price instrument/unit. Never fabricate EcoCoach prices or publish partial totals.
5. Present actual staging, scheduled comparison and Telegram evidence to the owner. Obtain explicit approval for controlled production writes and migration. Only then enable the production gate and perform a complete live sync plus exact readback. Confirm the next independent scheduled write and monitoring notifications.
6. Coordinate disabling `Trading Journal Portfolio Sync` in ChatGPT with the owner only after the replacement is verified and cutover approved. Do not assume this Codex environment can manage that automation. Avoid leaving two permanent production writers. Record which sender is active, run IDs, deployed commit and rollback steps.

If the independent writer fails after cutover, first set its gate false/disable its write schedule, inspect safe error codes and private readback, and coordinate resuming the previous sender. Never edit the workbook or overwrite newer snapshots to recover. Do not rotate existing credentials merely to diagnose a failure.

## Operational limits still outstanding

No live independent scheduled run, production readback, deployment verification, price completeness, Telegram command exchange or delivered alert has been verified by this development task. CI and operations workflow files are on the review branch; operations are not scheduled or activated. Recurring maintenance requires future Codex tasks and configured Actions; it does not happen automatically merely because this chat is open.
