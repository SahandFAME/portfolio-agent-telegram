# Latest Allocation: fresh quantities and prices

The owner authorized on-demand OneDrive synchronization on 2026-10-10. This
does not authorize a recurring replacement or retirement of the ChatGPT schedule.

`/latest_allocation` and the **آخرین ترکیب دارایی** button replace the separate
allocation and refresh options. Existing `/allocation`, `/refresh` and their old
Persian buttons (including آخرین تخصیص دارایی) open the same format submenu for
compatibility. Choose a Persian pictured report or detailed text report; the
text option sends category percentages in a separate final message.
**نمودار ترکیب دارایی** (`/allocation_chart`) directly requests a 3D-style pie
chart through the same fresh-quantity and fresh-price workflow.

## Verified worker and report flow

1. The bot authenticates the private Telegram user. Latest composition opens a
   picture/text submenu with a private, expiring, single-use selection UUID and
   a return-to-menu option. Opening it does not fetch data. A format choice (or
   direct chart command) records an opaque request UUID and output format
   privately in Vercel Blob. The approved chat ID stays in private storage.
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
   fetches market prices again and produces the chosen picture, text or chart.
   This second read avoids
   an old quantity snapshot if the owner waits before entering the price.

Errors stop report generation; an old cached report is not substituted. Requests
expire after ten minutes, and a snapshot must be at most two minutes old when a
successful callback begins report generation. Repeated taps while a request is
queued with the same format do not dispatch another job. Choosing a different
format supersedes the old job with a new fresh request; the old callback cannot
deliver the previous format. GitHub runner queues can add delay; if a
request expires, invoke Latest Allocation again. Blob state has no atomic
compare-and-swap: simultaneous requests are protected against stale report
completion by current-request and snapshot checks, but are not a distributed
transaction with the external ChatGPT sender.

Every output format uses one shared complete-valuation check and the same group
classification. Missing prices/quantities stop totals and percentages. Text
chunks retain complete asset blocks, and access/current-request checks run
before each chunk and its final percentage message. The pictured report uses
bundled Persian-capable regular/bold fonts and a right-to-left table. The chart
uses actual group values for slice angles and two-decimal labels, including
zero-category and single-category handling.

### Report appearance (owner-approved 2026-10-11)

All pictured reports use bundled **Estedad Regular/Bold**, replacing DejaVu.
The standalone composition chart uses the owner's selected **style B**: navy
background, soft 3D shading, rounded slice corners and colored callouts. Each
positive group's name and two-decimal percentage are connected to the midpoint
of its own slice's outer arc. Callout positions are selected around the pie in
circular order; larger connector displacements follow the exterior ellipse.
Zero groups retain a zero-percentage label with no invented slice or connector.
The theme does not change group classification, valuation, quantities, prices
or displayed precision. Persian calendar/Tehran timestamps remain bold.

Font files and their upstream provenance/license are in [assets/fonts](../assets/fonts/README.md).
Vercel explicitly bundles these files through `functions.api/telegram.js.includeFiles`;
the renderer does not need runtime font downloads or system fonts. Telegram's
ordinary text messages use the client-selected font; the Estedad setting applies
to generated images.

### Asset comments and footnotes (2026-10-11)

Display labels for assets with comments carry `*`; canonical asset names remain
unchanged in snapshots, price mappings and arithmetic. The four existing comments
cover بلک راک (EcoCoach), the receivable and Zarbod gold, and historical cash-dollar
purchases. Historical comments are transcribed from the handoff and never used
as current prices or quantity updates.

The assets list and category valuations end with only their related comments.
Detailed text ends with its asset footnotes before the separate group-percentage
message. Pictured tables include all their relevant comments in an expanded,
wrapped footer; its EcoCoach explanation is entirely Persian to avoid mixed
English/Persian bidirectional ordering. The composition chart carries the full
portfolio's notes in its plain-text photo caption. Image height grows to fit
the footnotes, while the chart remains 1600×1160. Prices, stored quantities,
on-demand sync, user access checks and report precision are unchanged.

The six manual holdings stay separate and unchanged. The workbook is never
saved, edited or uploaded. No credentials, quantities, prices or chat IDs are
printed by the sync worker. Workbook total validation is fail-closed.

## Guest reporting (owner-authorized 2026-10-13)

Approved non-admins have guest access to the composition chart only. The guest
renderer omits portfolio totals, asset notes and caption footnotes, while keeping
the category percentages from the same complete current valuation. Server-side
command, callback and delivery checks enforce this restriction. Admin demotion
during pricing or multi-message delivery blocks the previously prepared full
report. Guest requests with a missing EcoCoach price prompt an admin privately;
after manual entry the guest's request repeats fresh synchronization and receives
only the chart. All request deadlines and snapshot correlation safeguards remain.

Complete valuations first check the fund's public EcoCoach page, retaining quote
identity, per-unit currency and source freshness. The observed page currently
provides no unit quote, so manual fallback remains expected. See
[ECOCOACH_PRICING.md](ECOCOACH_PRICING.md) for evidence and validation rules.

## Production dispatch credential

Existing Microsoft authorization, token rotation and repository
`PORTFOLIO_SYNC_SECRET_AGENT` are verified. Do not recreate or rotate them.

The owner configured a dedicated fine-grained GitHub token for only
`SahandFAME/portfolio-agent-telegram`, with **Actions: read and write** and the
mandatory **Metadata: read-only** permission. It does not need Contents write
or Secrets permissions. It is saved as the **Vercel Production** environment variable
`GITHUB_ACTIONS_TOKEN`. Its presence and on-demand dispatch have been verified;
do not recreate it or put its value in chat or source control.

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

At the initial on-demand rollout, 45 Node actual-handler tests and 26 Python
tests passed. These historical checks covered
dispatch, aliases, callback authentication/correlation, replay, expiration,
revoked access, failed/mismatched refreshes, delayed EcoCoach input, exact sync
readback, quantity extraction, pricing and decimal presentation.

Production deployment and protected snapshot readback were verified for main
`7000aaf3e87033c948af19372ecd4635e3d6dd20`. A subsequent independent worker
trial verified a snapshot at `2026-10-11T02:55:13.704394Z`. The owner then confirmed
the Latest Allocation Telegram flow was working. This confirms the on-demand
integration; it does not verify or authorize a recurring scheduler migration.

Current output-format regression tests additionally cover the private submenu,
its expiry/replay/access guards, persistent format selection through the second
sync, complete text/toman/group arithmetic, failed or superseded text delivery,
Persian PNG rendering, and 3D chart angles/labels/zero groups. Run the full Node
and Python suites documented in [BOT_MENU.md](BOT_MENU.md) and the repository CI.
Automated renderer/handler checks and production deployment/API readback remain
distinct from a user's actual Telegram interaction.
