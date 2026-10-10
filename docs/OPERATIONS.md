# Operational ownership and migration

Read AGENTS.md, CODEX_HANDOFF.md and [Issue #1](https://github.com/SahandFAME/portfolio-agent-telegram/issues/1) first. The existing bot, private Blob cache, price providers and Telegram access controls are retained. Development changes are pushed to `codex/operational-ownership` for review; no merge, production promotion or migration was performed. The Trading Journal workbook is always read-only. No private workbook or credentials belong in this repository.

Codex tasks maintain this repository and prepare operations changes. A Codex chat is not a permanent worker or scheduler. GitHub Actions will execute independent jobs after configuration and explicit activation.

## Verified evidence and limits

Audit date: 2026-10-10, Asia/Tehran.

| Capability | Verified evidence | Remaining limit |
|---|---|---|
| Repository | Git read/write, PRs, merges, Actions dispatch/status verified | Cloud GitHub proxy cannot use the Secrets API; runner secret-writer credential works |
| Local bot | 26 actual-handler regression tests with mocked services and real Persian PNG rendering | Prepared fixes remain unmerged and are not claimed deployed |
| Production HTTP | HTTP 200 health and authenticated cache read; 23 assets | Cache verification timestamp remains 2026-10-10T06:13:28.437Z |
| Microsoft Graph | Independent personal-account consent, persisted refresh-token rotation, live workbook identity/eTag and all 23 explicit table totals verified in Actions | No scheduled quantity writer yet |
| Quantity comparison | All 23 compared with production; 20 exact matches and 3 differences within 1e-12 relative/absolute tolerance | Exact floating-point equality is not claimed; no rounding or cache updates performed |
| Telegram | Bot identity and production webhook verified, zero queued updates at inspection; owner supplied successful `/status` and `/assets` responses with all 29 assets | Other commands, pricing completeness and alerts remain unverified |
| Manual holdings | Owner's `/assets` output confirms all six manual holdings remain unchanged | No manual updates authorized |
| Vercel administration | Existing production API operational | Deployment/log/config administration access remains unresolved; do not infer token validity from a 403 alone |
| Independent operations | Manual read-only workflow repeatedly succeeded; regression suites prepared | Production-write workflow, recurring sync and monitoring activation remain gated |
| ChatGPT sync | Historical daily schedule around 09:00 Tehran from October 11 | Recurring execution not verified; left running |

Live verification evidence: [run 38062179238](https://github.com/SahandFAME/portfolio-agent-telegram/actions/runs/38062179238).
Workbook modification time was 2026-10-09T08:00:36Z. A fresh read of an
unchanged file verifies quantities without updating the production cache's
freshness clock. The owner's Telegram results establish those two command
responses; they do not prove other commands, fresh prices or recurring sync.

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

1. **Vercel administration:** resolve access to deployment status, runtime logs, preview settings and project configuration. The production API works, but this does not establish administration access. A preview must use isolated Blob/auth configuration and must not share writable production storage.
2. **Telegram testing:** the owner has verified `/status` and `/assets`. Verify `/gold`, `/crypto`, `/cash`, `/allocation` and `/refresh` next, including unavailable-price behavior. Select an authorized private alert chat and explicitly authorize any automated messages before sending them.
3. **Repository operation settings:** populate nonsecret variables below, configure production-write review where supported, and verify the owner's GitHub Actions failure-notification settings. Existing Microsoft consent, refresh-token persistence and repository production-read secret are verified; do not request them again.
4. **Migration:** approve a concrete, reviewed production-write trial and later recurring cutover only after replacement validation. No production-write approval or ChatGPT scheduler retirement has been given.

The saved cloud draft declares missing service bindings and nonsecret identifiers; it does not grant permissions, create OAuth consent, populate GitHub Actions secrets, execute jobs or publish anything. Review and save changes in environment settings, then publish the environment. Access held by ChatGPT's OneDrive connector is not inherited by GitHub Actions or Codex.

## Secure consent and configuration

Microsoft consent is already complete. If it must be renewed, use the manual
`microsoft-consent.yml` workflow and `scripts/authorize_microsoft.py`, which honors
Microsoft's returned verification URL. Personal accounts currently use
`https://www.microsoft.com/link`; do not substitute `devicelogin`. The old
`authorize_graph.py` name delegates to this verified helper. Never attempt secret
writes through the Codex GitHub proxy: it overrides GitHub authentication and
cannot validate or use the supplied Secrets-write PAT. Run token persistence
inside Actions, where the credential has been proven usable.

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
