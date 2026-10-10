# Portfolio Agent — Complete Codex Project Handoff

**As of:** 2026-10-10 (Tehran time)  
**Primary repository:** https://github.com/SahandFAME/portfolio-agent-telegram  
**Branch:** `main`  
**Production API:** https://portfolio-agent-telegram.vercel.app/api/telegram  
**Telegram:** @SaRoPortfolioAgentBot  
**ChatGPT project:** Portfolio Agent  
**Status:** Source, bot, authenticated sync and snapshot readback verified; a daily external automation has been scheduled, but its first recurring run and a fresh end-to-end Telegram /status exchange are **not** independently verified.

This document reconstructs the work that can be established from project instructions, historical conversation summaries, the live GitHub source, Vercel inspection, and a 2026-10-10 OneDrive workbook read. It does **not** claim to be a verbatim transcript of every historic chat or a backup of private service credentials. When history and current source differ, current source and live checks take precedence, with the discrepancy noted.

## 1. Mission

Build a personal, read-only portfolio and asset-management agent spanning ChatGPT + Microsoft OneDrive + Vercel + Telegram. Maintain 29 assets, value them using independent and appropriately sourced **current** prices, and provide asset balances, total value, allocation and category reports. The Telegram bot is a *presentation channel*, not a portfolio source of truth. A stale cached quantity must never be presented as if freshly retrieved from OneDrive.

**Canonical quantity split:** 23 Trading Journal-controlled + 6 explicitly manually controlled = **29 assets**.

## 2. System architecture

```text
OneDrive: Trading Journal.xlsm (AUTHORITATIVE, READ-ONLY)
  └─ 23 configured Excel tables, verified current-balance quantities
        └─ authorized sync bridge / ChatGPT scheduled task
             └─ authenticated POST /api/telegram?sync=portfolio
                  └─ Vercel Blob private: portfolio/latest.json (CACHE)
                        └─ Vercel Node serverless: api/telegram.js
                             ├─ manual six quantities in application code
                             ├─ independent external market quotes
                             ├─ Telegram webhook/access control
                             └─ Telegram /status /assets /allocation etc.
```

**Identity/auth boundaries:** ChatGPT's SharePoint/OneDrive connector authentication is **not inherited** by a separate Vercel runtime. Consequently the source workbook and bot cache are separated. A local Windows/OneDrive bridge had originally been contemplated; no such sender was identified in the current repository or connected automations when investigated on Oct 9. On Oct 10 a new independently authenticated one-time sync was performed and a recurring **ChatGPT automation** was created. That automation does **not** exist as a Vercel Cron or GitHub Actions workflow; it depends on future access to the relevant connected services.

### Service identifiers (not credentials)

- GitHub owner/repo: `SahandFAME/portfolio-agent-telegram`; branch `main`.
- Vercel project: `portfolio-agent-telegram`, ID `prj_l9OXctmAdtJa7U4KMOZoI27w0sNA`; team ID `team_vmBch9HaWhgdXhVB1Xa8UNdj`.
- Production host: `portfolio-agent-telegram.vercel.app`.
- Telegram handle: `@SaRoPortfolioAgentBot`.
- OneDrive Graph drive ID: `daef687b3c624f3`; workbook item ID `DAEF687B3C624F3!2063`. IDs are identifiers, not authentication: still require the owner's authorized OneDrive connection.
- Source workbook is `Trading Journal.xlsm` in the user's OneDrive. No raw workbook is committed to GitHub.
- Private Vercel Blob paths used by current source: `portfolio/latest.json` (quantities), `portfolio/access-control.json` (approved/pending users), `portfolio/pending-blackrock/{chatId}.json` (interaction state). Blob is private.

## 3. Exact Trading Journal mapping

For each listed workbook asset, **find the Excel table by its actual internal table name**, read the indicated column, **verify table structure and intended current balance**. Some tables carry calculated total rows; do not sum all history or choose an arbitrary last transaction row. The workbook must not be saved by the extractor.

| Asset | Excel table | Column |
|---|---|---|
| طلا | Table5731 | حجم خرید |
| عیار | Table51433 | حجم خرید |
| گوهر | Table51032 | حجم خرید |
| آلتون | Table5102338 | حجم خرید |
| امرالد | Table510232439 | حجم خرید |
| زرفام | Table5102324396 | حجم خرید |
| نهال | Table15182528294354 | حجم خرید |
| طعام | Table1518252829435 | حجم خرید |
| استیل | Table15182540 | حجم خرید |
| فلز فارابی | Table151825282943 | حجم خرید |
| پتروآگاه | Table1518252741 | حجم خرید |
| خودران | Table1518252842 | حجم خرید |
| بلک راک | Table151825408 | حجم خرید |
| سجام | Table53011 | حجم خرید |
| فملی | Table15347 | حجم خرید |
| شمش نقره 999 | Table151825274110 | حجم خرید |
| BTC | Table13 | Quantity |
| ETH | Table1 | Quantity |
| Tether | Table13444 | Quantity |
| Link | Table1312 | Quantity |
| ADA | Table131219 | Quantity |
| SOL | Table131213192120 | Quantity |
| ONDO | Table13121319212022 | Quantity |

**Ignore in workbook:** `Data Extraction Sheet`, Power Query output, formulas/external values relating to market price or portfolio valuation. Quantity total formulas and verified quantity balances are relevant.

### Six manually controlled holdings

These must **not** be inferred from the workbook or overwritten by a sync:

| Asset | Quantity | Unit |
|---|---:|---|
| سکه تمام | 3 | coins |
| ربع سکه غیره | 3 | coins |
| ربع سکه بانکی | 1 | coins |
| آبشده (طلب) | 1.37 | g |
| آبشده (شمش زربد) | 20 | g |
| دلار | 3030 | USD |

Change only on the user's explicit update. Current bot stores them in `const MANUAL` inside `api/telegram.js`; future maintainers should consider a secure, controlled persistent update mechanism rather than silent hardcoded edits.

### Asset notes and disambiguation

- **بلک راک** is the Iranian **EcoCoach private fund**, *not* BlackRock Inc, `BLK`, or a foreign ETF. User must supply fund-specific current per-unit price if no dependable public quote exists. This asset has 15 units as of last verified workbook read.
- **آبشده (طلب)**: contextual receivable, not standard physical possession. Preserve historical note verbatim: `طلب از مامان به ازای ما به تفاوت خرید شمش زربد (9200 تومان در گرم طلا 6718)`.
- **آبشده (شمش زربد)**: 20 g gold bar; preserve `شمش زربد (در گرم 6718)` and `1404/01/26`.
- **دلار**: historical acquisitions `700 دلار در 83000 (04/02/20)` and `2300 دلار در 108800 (04/08/04)`. These are historical acquisition notes, **not** current exchange rates.
- Treat `شمش نقره 999` as the user's actual holding instrument/unit with verified market-price basis; do not assume it means physical grams when the table represents units.

## 4. Verified workbook balances / freshness

The OneDrive file was freshly fetched for this handoff. On **2026-10-10**, connector metadata showed workbook modification time **2026-10-09 08:00:36 UTC**; extraction checked the 23 configured table current totals.

| Asset | Live verified quantity |
|---|---:|
| طلا | 386 |
| عیار | 1859 |
| گوهر | 195 |
| آلتون | 12565 |
| امرالد | 4242 |
| زرفام | 30390 |
| نهال | 1628 |
| طعام | 41673 |
| استیل | 3263 |
| فلز فارابی | 1601 |
| پتروآگاه | 767 |
| خودران | 16774 |
| بلک راک | 15 |
| سجام | 13368 |
| فملی | 9552 |
| شمش نقره 999 | 256 |
| BTC | 0.00519153 |
| ETH | 0.40602 |
| Tether | 2617.574383 |
| Link | 0.003 |
| ADA | 0 |
| SOL | 0 |
| ONDO | 0 |

**Comparison to prior Oct 5 snapshot:** BTC 0.00452153 → 0.00519153; Tether 2675.375283 → 2617.574383; ADA 0.13 → 0; SOL 0.0012 → 0; ONDO 0.076 → 0. Other 18 unchanged. Earlier project instruction files and `Portfolio_Agent_Config.json` contain the **older historical snapshot**; never overwrite a successful live retrieval with their values.

**Oct 10 production confirmation:** authenticated POST to `?sync=portfolio` returned HTTP 200 with `{"ok":true,"received":23,"stored":true}`. Protected GET `?data=portfolio` returned the 23 quantities above; snapshot `updated_at` was **2026-10-10T06:13:28.437Z**. This verified the **cache** at that time, not any future scheduled runs.

## 5. Application and Telegram commands

Current implementation: `api/telegram.js`, a Vercel Node webhook. `package.json` is ESM and includes `@vercel/blob`, `@vercel/functions`, `sharp`, `@resvg/resvg-js`, `dejavu-fonts-ttf`, `node-fetch`. `vercel.json` is `{"version":2}`.

HTTP routes (query on the same serverless endpoint):

- `GET /api/telegram`: unauthenticated lightweight service health response (not a quantity-sync status).
- `GET /api/telegram?setup=webhook`: bot webhook setup route (protect according to current implementation).
- `POST /api/telegram`: Telegram webhook; validates `x-telegram-bot-api-secret-token` when configured; handles only private chats and approved users/admins.
- `POST /api/telegram?sync=portfolio`: authenticated JSON quantity snapshot upload.
- `GET /api/telegram?data=portfolio`: authenticated private snapshot inspection.

Telegram user features:

- `/start`, `/help`: onboarding/help. Nonapproved private users may request access.
- `/status`: bot connection + last cached sync timestamp and workbook file timestamp, warning if stale.
- `/assets`: all 29 quantities (23 stored snapshot plus six manual); shows timestamp; **note**: inspect behavior when snapshot is stale because quantities may be displayed with timestamp.
- `/allocation`: full report with live pricing and image/chart only if all required values are reliable.
- `/refresh`: re-retrieve market prices/rebuild report; **does not itself pull quantities from OneDrive**.
- `/gold`, `/crypto`, `/cash`: category valuation; incomplete price/quantity → list missing instead of misleading subtotal.
- Access control: `/users`, `/approve USER_ID`, `/revoke USER_ID` for configured admins; inline Approve/Reject keyboard on access requests.
- When full valuation lacks a reliable EcoCoach `بلک راک` price, request user's current price in **toman per unit**; preserve rial conversion if the message explicitly says ریال; store pending state privately.

**Rendering:** SVG-based Persian portfolio reporting converted to PNG via `@resvg/resvg-js` and `sharp`, using DejaVu font. Source has long Telegram message splitting logic to accommodate 4096-character limits. Do not embed secrets or private user IDs in screenshots/logs.

**Authorization:** The bot is private. `TELEGRAM_ADMIN_USER_IDS` defines bot admins; access requests are stored in private Blob and actioned by configured admins. Preserve this behavior.

## 6. Sync payload and API contract

The **current** sync handler requires `version`, valid ISO parseable `updated_at`, optional parseable `workbook_updated_at`, and `assets` object containing **exactly all 23 workbook assets** (no manual assets). Quantities must be finite, numeric and nonnegative.

Illustrative payload (do not copy the shortened set to production):

```json
{
  "version": "OneDrive Trading Journal verified",
  "updated_at": "2026-10-10T06:13:28.437Z",
  "workbook_updated_at": "2026-10-09T08:00:36Z",
  "assets": {
    "BTC": 0.00519153,
    "ETH": 0.40602,
    "Tether": 2617.574383,
    "ADA": 0,
    "SOL": 0,
    "ONDO": 0
  }
}
```

**Important:** That six-asset snippet is **illustrative and invalid** as a submitted payload; a real request must include all 23 precisely matching the table mapping in §3. The endpoint rejects incomplete/unexpected names and old workbook timestamps with HTTP 400/409; wrong secret yields HTTP 401. Success response `ok:true,received:23,stored:true` is necessary, but **then read back** the protected snapshot and compare every quantity.

Header: `x-portfolio-sync-secret`. Production has encrypted `PORTFOLIO_SYNC_SECRET` (original) and independent `PORTFOLIO_SYNC_SECRET_AGENT` (added Oct 10), **both accepted** to preserve compatibility. Retrieve secrets only via authorized secret-management/connector access. Never put secret contents in prompts, docs, shell logs or repo.

**Potential issue worth testing:** old sender historically posted 29 assets, whereas new handler strictly requires 23 workbook-only assets. If the old sender reappears, it might receive HTTP 400. Prefer updating that sender to omit manual assets; do not let a sender overwrite manual quantities. Incoming monotonicity currently compares `workbook_updated_at || updated_at` against the previously stored equivalent; review for cross-version timestamp semantics and concurrency races.

**Snapshot staleness:** Current bot checks `snapshot.updated_at` rather than workbook file modification time, max age 24 h. A valid newly reread unchanged workbook must still be considered a fresh **sync**. The bot's `/refresh` market refresh and cache quantity refresh must be distinguished.

## 7. Market prices and valuation rules

Never take `Trading Journal.xlsm` price cells or Power Query current value as market truth. Prices are obtained independently per asset and supported by source + retrieval time:

- Iranian gold/coins, USD/IRR: TGJU or reliable current Iranian market sources; verify whether a published number is rial or toman.
- Iranian listed stocks, funds and certificates: live/last-traded market prices from matching **Iranian instrument** (TSETMC, TGJU, Shakhesban as available); **do not silently substitute NAV**.
- 999 silver: check instrument and price basis; physical gram vs listed certificate unit must match actual holding. The bot source currently includes a Shakhesban silver function, not necessarily identical to per-gram physical spot.
- Crypto: CoinGecko or equivalent USD spot source; preserve native coin amounts and USD amounts, convert through independently fetched free-market USD/IRR.
- 18K/melted gold: current appropriate 18K/آبشده per gram; 1.37 g and 20 g.
- `بلک راک`: EcoCoach-specific trusted current unit price, or ask user. **Never** map to BlackRock `BLK`.

When a price is unavailable or suspect: request current price; mark incomplete; do **not** display an understated total, allocation percentage, or pie chart. For cash, use 3030 USD × free-market USD/IRR. For numeric reports, carefully normalize IRR vs toman (1 toman = 10 IRR), grams, number of coins, listed units/shares, and cryptocurrencies.

**Source code pricing functions:** `tgju`, `tsetmc`, `tgjuMarket`, `shakhesban`, `shakhesbanSilverBar`, `getListedPrice`, `getPrices`, `valueRial`, `valuationReply`, `allocationImageReply`, `buildPortfolioSvg`. Review source implementations instead of assuming a provider is currently reachable. Live pricing availability across **all** assets has not been independently reverified for this handoff.

**Historical portfolio target (2026-02-27):** Gold 38%, Silver 4%, Crypto 10%, Tether 11%, USD cash 17%, Stock 20% (total 100%). User's earlier then-current allocation: Gold 51%, Silver 4%, Crypto (BTC/ETH) 5%, Tether 15%, USD cash 17%, Stock 8%. These are historical reference targets/current readings from that discussion and may no longer reflect current user intent. Reconfirm before making trades or live comparisons.

## 8. History / decisions / previous repairs

This is a source-based reconstructed chronology, not an exhaustive quote-by-quote conversation export.

### Prior to October 2026
- User tracked trade-level BTC and ETH buys/sells; negative transaction quantities meant **sells**. User discussed portfolio rebalancing and a target allocation in Feb 2026.
- User wanted reliable live prices and a consolidated portfolio rather than treating an old portfolio snapshot as current.

### 2026-10-05: Agent and Telegram plan
- Established a ChatGPT Project called **Portfolio Agent**, with rules for 29 assets, quantity authority, independent pricing and no invented prices; user/project instructions and `Portfolio_Agent_Config.json` prepared.
- Planned Telegram commands `/status`, `/assets`, `/allocation`, `/gold`, `/crypto`, `/cash`, `/refresh`, and natural-language queries. Note: arbitrary natural-language financial Q&A is **not** established as implemented by current bot; unknown text falls back to `help()`.
- Telegram credential was shared in a historic chat. It was treated as compromised; the user was told to revoke it through BotFather, regenerate it and keep the replacement only in Vercel environment secrets. Do not recover/reproduce old credentials.
- Created/connected GitHub repository and Vercel project. An invalid initial `vercel.json` runtime declaration caused build failure; replacing it with `{"version":2}` fixed deployment. Initial configuration included `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`; deployment protection/setup had to be addressed.

### 2026-10-06: Cloud cache / integration limitation
- Connected private Vercel Blob storage, introduced production `PORTFOLIO_SYNC_SECRET`; designed HTTPS sync endpoint and private cache. Original conceptual sender was Windows/laptop OneDrive bridge; user was using another computer and that extractor was deferred.
- Established that a Vercel function cannot directly reuse ChatGPT's delegated SharePoint OAuth session. OneDrive workbook therefore stayed the source; Vercel snapshot a secondary presentation cache.

### 2026-10-07: Live workbook reading, bot and pricing
- OneDrive connector successfully retrieved the workbook. Historical Vercel sync accepted/stored a payload with **29** entries in an earlier implementation (now superseded by 23-only strict validation).
- Telegram webhook, private access controls, and `/status`/`/assets` were reported operational in the 2026-10-07 setup history. A separate previous update had said the full Telegram end-to-end test was not independently verified; treat those as different points in the rollout, and retest now.
- Added independent price source integration (CoinGecko, TGJU, TSETMC, Shakhesban fallback), Persian SVG/PNG report and valuation commands. One deployment had initially been rejected on Vercel connection permissions; later builds became READY after access/deployment work. Distinguish code deployment from functional quote verification.

### 2026-10-09: stale/incomplete valuation safeguards
- Investigated: bot quantities were older than live workbook. Live latest workbook had BTC 0.00519153, Tether 2617.574383, and ADA/SOL/ONDO 0.
- Commit `126c19cbef958d441223f09cf816f6482f2a4029`: block stale/incomplete valuation; warn on `/status`; prevent misleading totals/percentages/chart when any required input missing.
- Commit `dcb7f1937ca1b08d16f8fd35134b89f875bc42d6`: safeguard user-entered EcoCoach price, preserve slash commands during pending price input, avoid double counting or NaN on بلک راک.
- Commit `81469b1ef5316c306602c705b119cb977d89e87c`: validate sync payload completeness/timestamps/quantities, safe logging, reject overwriting newer cache; **23-only** contract introduced.
- No original active sync sender found in repository GitHub Actions, Vercel Cron, or then-connected ChatGPT automations. Existing `PORTFOLIO_SYNC_SECRET` env variable had been updated on Oct 7 and earlier cache time was Oct 5; potential secret mismatch was hypothesized but **never confirmed**.

### 2026-10-10: independent repair and confirmation
- Live workbook re-fetched; all 23 balances verified, six manual preserved.
- Added `PORTFOLIO_SYNC_SECRET_AGENT` via encrypted Vercel Production environment setting without rotating/deleting original sender credential.
- Commit `390a9a6757a96ea4e980a33c4a9068d237181399`: sync auth now accepts independently managed secondary secret as well as original secret.
- Commit `3414422b881c90378138a4f0465c2050780363f6`: freshness clock based on `snapshot.updated_at`, not workbook file's edit time.
- Production authenticated POST succeeded **HTTP 200**, `received:23`, `stored:true` at **2026-10-10T06:13:28.437Z**; protected GET echoed 23 correct quantities. Vercel builds reported READY for prior commits, and a subsequent most recent deployment was observed queued during the inspection; confirm final deployment state/commit when continuing.
- Created ChatGPT automation **Trading Journal Portfolio Sync**, enabled, intended **daily around 09:00 Asia/Tehran**, first scheduled run **2026-10-11**. It retrieves workbook, verifies 23, posts authenticated payload and reads cache back. **No recurrence outcome verified yet; do not equate scheduled with tested.**
- Telegram /status was not independently invoked in the Oct 10 repair; end-to-end Telegram message processing must still be checked using a legitimate authorized bot account/chat.

### Latest handoff preparation
- Added `AGENTS.md` and this document to the same GitHub repository to let Codex discover project-specific boundaries automatically.

## 9. Secret/configuration inventory — names only

Never commit plaintext values or print decrypted values:

| Setting | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API calls |
| `TELEGRAM_WEBHOOK_SECRET` | Verify Telegram webhook header |
| `TELEGRAM_ADMIN_USER_IDS` | Private bot administration |
| `PORTFOLIO_SYNC_SECRET` | Original private sync header credential |
| `PORTFOLIO_SYNC_SECRET_AGENT` | Secondary encrypted sync header credential added Oct 10 |
| `BLOB_READ_WRITE_TOKEN` | Vercel private Blob |
| `SETUP_SECRET` | Webhook setup route authorization |

**Security design:** protect webhook, limit users, separate admin rights, protect cache GET, prevent snapshot tampering, reject incomplete/outdated sync. Use service UI/secret store to rotate credentials. Historical compromised bot token must remain revoked.

## 10. Operational playbooks

### Obtain and verify fresh balances

1. Connect the user's authorized Microsoft OneDrive/SharePoint account; find `Trading Journal.xlsm` by name; confirm drive item, modified time and metadata.
2. Retrieve raw XLSM **read-only**; parse via a library that can inspect named Excel tables, totals and formula/cached-result semantics. Never save XLSM. Do not trust a static copy if the connector is accessible.
3. Iterate the **23 exact table names** in §3; record sheet, table range, matching quantity column and derived intended current total. Confirm finite numeric values including legitimate zeros; reject missing/ambiguous.
4. Compare all 23 with the previous snapshot, log changed names and counts without disclosing private financial data unnecessarily.
5. Construct payload of **only** these 23; inject authorized secret from Vercel credential store into private header; POST production `?sync=portfolio`.
6. Require HTTP 200, then authenticated GET `?data=portfolio` and compare all 23 + timestamp exactly. A healthy `GET /api/telegram` does not prove a sync.
7. Check `/status` and `/assets` in Telegram using an authorized account (screenshot or logs when possible). Retain no local credential artifacts.

### Deploy safely

1. Inspect `AGENTS.md`, current `api/telegram.js`, `package.json`, `vercel.json`; fetch latest `main`.
2. Use branch + PR for nontrivial changes (recommended); preserve private asset metadata; never check in workbook or secret file.
3. Implement tests for sync input contract, total-row quantity extraction, unit conversions, 29-asset completeness, stale-cache guard, price missing behavior, EcoCoach input and Telegram authorization.
4. Test ESM syntax, integration mocks, and production-safe error handling; deploy via connected GitHub/Vercel.
5. Wait for production READY **for the intended commit**, inspect logs, confirm authenticated sync/readback and Telegram E2E separately.
6. Report which checks were actually performed, where test coverage remains unverified.

### Troubleshooting matrix

| Symptom | Likely areas | Safe response |
|---|---|---|
| `401` on sync | Wrong/missing header, old sender secret, production env settings | Verify secret **metadata** and sender configuration; never echo secret values |
| `400` on sync | Missing 23 asset names, 29-vs-23 old payload, invalid number/time | Correct sender payload; do not weaken manual-asset boundary |
| `409` on sync | Old workbook timestamp, conflicting source precedence | Refetch live workbook, verify chronological source; avoid force overwriting |
| `500` on sync | Blob configuration/storage/permissions | Check Vercel private storage connection and sanitized runtime errors |
| `/status` stale after successful sync | Wrong production deployment, failed cache read, stale `updated_at` | Authenticate GET and compare, then inspect bot command routing |
| Missing allocation/chart | Missing EcoCoach price or external market quote | Show missing input; never fabricate quote or subtotal |
| Telegram silent | Webhook not set, wrong secret, access denied, outbound API error | Test webhook setup and authorization safely; avoid exposing chat IDs/tokens |
| Workbook balances unexpectedly change | Wrong total-row semantics, source file older, formula cached value | Inspect configured table and actual current balance; do not sum blindly |

## 11. Open items and recommended Codex backlog

1. **Identify/retire the original sender**: previous Windows bridge was planned but not located. Verify old sync secret has no unknown active sender; avoid duplicate competing writes. Document exact new automation owner, permissions and failure notifications.
2. **Make recurring sync robust independently of chat automation** if needed: implement an explicitly authenticated scheduled integration (e.g. a user-authorized Microsoft Graph app/Power Automate), without assuming Vercel has ChatGPT OAuth. Never construct public OneDrive share links without user request.
3. **Telegram E2E**: send actual `/status`, `/assets`, `/allocation` from an authorized private Telegram chat; verify responses against cache and appropriate missing-price messaging.
4. **Tests / code structure**: monolithic ~51 KB `api/telegram.js` has no test script in `package.json`; split into modules and add automated tests. Include 23-asset extraction, negative/zero balances, malicious payload, timestamp monotonicity, IRR/toman/unit conversions, fallback parsing, stale/partial report, image generation, and EcoCoach workflow.
5. **Pricing completeness**: test every 29-asset instrument with reliable fresh market quote. Current external endpoints may change or block; treat failures as unknown and request user price, not guessed fallback. Preserve retrieval times in reports.
6. **Manual-holding persistence**: store six quantities securely in a controlled config, updated only with explicit user permission; add audit history.
7. **Target allocation**: add optional comparison to the old 38/4/10/11/17/20 target *only after confirming it is still current*; distinguish stablecoin Tether from other crypto.
8. **Security hardening**: review access-control races, protected setup route, header comparison, callback authorization, logging, replay safety, snapshot concurrency, and cache integrity.
9. **Documentation/operations**: update outdated `README.md`; describe scheduled task ownership and how Codex or a non-ChatGPT runtime can obtain its own delegated Microsoft Graph authorization.
10. **Recover original full conversations if desired**: the historical notes above are summaries and repository evidence, not all original chat messages. Export/paste project chats separately to Codex if verbatim discussion provenance is essential.

## 12. Codex environment setup

1. In Codex, connect/authorize GitHub and select **`SahandFAME/portfolio-agent-telegram`**, branch `main`. This repository is the durable code-and-handoff source; uploading only the chat narrative will not transfer the running bot or service ownership.
2. Open `AGENTS.md` and this handoff first; inspect Git history and `api/telegram.js`.
3. Connect or separately authorize Vercel project access and Microsoft OneDrive/SharePoint with least privilege as available. Codex **does not automatically inherit** ChatGPT Project connector auth or the separately created ChatGPT automation.
4. Do not paste secret values into Codex prompts, repository files, or screenshots. Use service-managed secrets.
5. Keep the workbook read-only, bot Vercel deployment in place, and external scheduled sync enabled until a tested replacement is ready. Do not create duplicate scheduled senders that race.

### Suggested initial Codex prompt

> Read AGENTS.md and docs/CODEX_HANDOFF.md completely. Audit the repository, current Vercel production deployment, the OneDrive source-of-truth workbook authorization strategy, and sync contract. Create a prioritized, testable repair plan; add reliable tests; verify daily sync and Telegram /status end to end. Preserve all 29 assets, read-only workbook rules, six manually controlled holdings, accurate Iranian instrument mappings and secret hygiene. Distinguish actually verified checks from assumptions. Never invent prices or produce incomplete portfolio totals.

## 13. Known constraints on this transfer

- This repo contains app source and this handoff, **not** ChatGPT Project memory/settings, the original OneDrive workbook, Vercel secrets, Telegram ownership, historical raw chats, or scheduler credential grants.
- The GitHub history captures changes made in the repository; private ChatGPT conversations require separate export if complete verbatim history is required.
- The source workbook must continue to be accessed via authorized OneDrive rather than duplicating sensitive source records into Git.
- Verification snapshots are point-in-time **audit evidence**, not an instruction to avoid refreshing.
