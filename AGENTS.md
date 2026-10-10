# Codex instructions — Portfolio Agent

Read [docs/CODEX_HANDOFF.md](docs/CODEX_HANDOFF.md) **before changing this project**. It contains the design history, source-of-truth rules, 29-asset mapping, deployment/integration status and backlog.

## Non-negotiable controls

1. **OneDrive `Trading Journal.xlsm` is authoritative for 23 assets**; the bot's private Vercel Blob snapshot is only a cache. Retrieve a fresh OneDrive version before calling holdings current. Workbook is **read-only**: never change/save/re-upload it.
2. **Six manually managed holdings are separate**; change their quantities only with explicit user instruction. Never overwrite them from a sync payload.
3. Verify all 23 workbook-derived quantities from the named Excel table **current-balance/total** values. Never blindly sum transaction rows. Read `حجم خرید` for Persian entries and `Quantity` for crypto. Do not rely on workbook price/valuation fields, Power Query, or `Data Extraction Sheet`.
4. There are **29 assets**, including Iranian private EcoCoach `بلک راک` (NOT BlackRock Inc / NYSE:BLK). Never fabricate an EcoCoach or any other quote.
5. Fresh prices must come independently from reliable sources, with units (rial/toman/USD/grams/shares), timestamp and source. If unavailable, ask for the price; **do not produce misleading partial portfolio totals, charts, or allocation percentages**.
6. Do not commit or print Telegram token, OAuth tokens, Vercel credentials, sync secrets, Blob tokens, or private portfolio workbook. No anonymous OneDrive shares. Use Vercel environment variables; keep production secrets out of logs.
7. Sync API currently accepts exactly the **23 workbook-controlled assets**, not 29; the six manual quantities are merged within the bot.
8. Validate authentication, freshness, payload completeness, nonnegative finite balances, and production readback. Existing security safeguards should not be weakened to bypass sync problems.
9. Do not claim that a Vercel build proves Telegram `/status` was received. Separate source inspection, deployment readiness, authenticated API readback, and Telegram end-to-end testing.
10. Document provenance and distinguish historical decisions from verified production behavior.

## Start here

- App: `api/telegram.js` (Vercel Node serverless webhook; private Blob snapshot and access state).
- Config: `vercel.json`, `package.json`.
- Handoff: [docs/CODEX_HANDOFF.md](docs/CODEX_HANDOFF.md).
- Repo: `SahandFAME/portfolio-agent-telegram` (`main`).
- Production: `https://portfolio-agent-telegram.vercel.app/api/telegram`.
- All changes: add regression tests for sync and financial arithmetic, test locally, inspect production deploy, and perform safe authenticated readback before declaring success.

## Suggested first Codex task

Audit the source against the handoff; identify the **original external sync sender** if possible without exposing secrets; ensure recurring live workbook sync succeeds; correct data-integrity gaps; add unit/integration tests and verify Telegram commands end-to-end. The ChatGPT scheduled task created 2026-10-10 is an **external automation**, not a workflow stored in this repository; its future runs have not yet been verified.
