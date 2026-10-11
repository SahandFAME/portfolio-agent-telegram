# Latest Allocation: fresh quantities and prices

The owner authorized on-demand OneDrive synchronization on 2026-10-10. This
does not authorize a recurring replacement or retirement of the ChatGPT schedule.

`/latest_allocation` and the **Latest Allocation** button replace the separate
allocation and refresh options. Existing `/allocation`, `/refresh` and their old
Persian buttons route to the same new operation for compatibility.

## Verified worker and report flow

1. The bot authenticates the private Telegram user and records an opaque request
   UUID privately in Vercel Blob. The approved chat ID stays in private storage.
2. It dispatches `latest-allocation-sync.yml` using a dedicated Actions credential.
   There is no schedule. The bot acknowledges the request and does not render
   an old cached allocation while waiting.
3. GitHub Actions refreshes the independent read-only Microsoft consent, securely
   persists rotated refresh tokens, reads the live workbook and checks its eTag,
   identity and all 23 explicit cached table totals.
4. The worker checks prior state, rejects older/future source versions, sends the
   complete 23-asset payload, requires a confirmed write, and compares the
   authenticated readback exactly. Writes are never blindly retried.
5. An authenticated completion callback identifies the private request. The bot
   rechecks user access, expiration, current request and the exact fresh snapshot
   before fetching market prices. Replayed or superseded callbacks are ignored.
6. If EcoCoach requires a price, the bot shows the original concise prompt.
   When that price is entered, it reads and synchronizes OneDrive again, then
   fetches market prices again and produces the image. This second read avoids
   an old quantity snapshot if the owner waits before entering the price.

Errors stop report generation; an old cached report is not substituted. Requests
expire after ten minutes, and a snapshot must be at most two minutes old when a
successful callback begins report generation. Repeated taps while a request is
queued do not dispatch another job. GitHub runner queues can add delay; if a
request expires, invoke Latest Allocation again. Blob state has no atomic
compare-and-swap: simultaneous requests are protected against stale report
completion by current-request and snapshot checks, but are not a distributed
transaction with the external ChatGPT sender.

The six manual holdings stay separate and unchanged. The workbook is never
saved, edited or uploaded. No credentials, quantities, prices or chat IDs are
printed by the sync worker. Workbook total validation is fail-closed.

## One remaining production credential

Existing Microsoft authorization, token rotation and repository
`PORTFOLIO_SYNC_SECRET_AGENT` are verified. Do not recreate or rotate them.

Create a dedicated fine-grained GitHub token for only
`SahandFAME/portfolio-agent-telegram`, with **Actions: read and write** and the
mandatory **Metadata: read-only** permission. It does not need Contents write
or Secrets permissions. Save it as the **Vercel Production** environment variable
`GITHUB_ACTIONS_TOKEN`. Do not put its value in chat or source control.

This permits the existing bot to dispatch the reviewed workflow. Repository
workflow changes are a trust boundary because Actions can use repository secrets;
review them carefully. The earlier secret-writer token remains restricted to
refresh-token persistence inside Actions and is not reused for dispatch.

The Microsoft client ID in source is a public application identifier, not a
credential. The configured drive/item identifiers and workflow destination are
fixed to the existing project. Current Codex Vercel administration access receives
403, so the owner must supply the dispatch token through Vercel settings.

## Evidence and deployment gates

The independently executed [sync trial](https://github.com/SahandFAME/portfolio-agent-telegram/actions/runs/38078833067)
verified all 23 quantities, stored the new production snapshot and confirmed
exact authenticated readback at 2026-10-10T19:12:05.834307Z
(22:42:05 Asia/Tehran). No Telegram message was sent by this trial.

Local checks: 45 Node actual-handler tests and 26 Python tests pass. Tests cover
dispatch, aliases, callback authentication/correlation, replay, expiration,
revoked access, failed/mismatched refreshes, delayed EcoCoach input, exact sync
readback, quantity extraction, pricing and decimal presentation.

The Telegram integration must not be called fully operational until the Vercel
dispatch credential is configured, the intended production deployment succeeds,
and the owner invokes Latest Allocation and receives the verified image. The
existing production commands remain in place until that integration is deployed.
