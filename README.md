# Portfolio Agent — Telegram portfolio reporting

Portfolio Agent is a private Persian Telegram bot for viewing the composition,
quantities and current valuation of a 29-asset family portfolio. It combines
verified quantities from a read-only OneDrive Trading Journal with independent
market prices, access-controlled reports, administration tools and a monthly
history measured in grams of 18K gold.

The bot is a reporting system. It does not place trades, transfer money or modify
the source workbook.

## What it can do

- Refresh all 23 workbook-controlled quantities from OneDrive before preparing
  every asset, category, allocation or history report.
- Preserve six separately managed holdings without allowing a workbook sync to
  overwrite them.
- Produce categorized asset lists, detailed text valuations, Persian pictured
  reports and a modern 3D-style asset-allocation chart.
- Report precious metals, crypto and cash dollars separately with exact units,
  live source attribution and Persian/Tehran timestamps.
- Track monthly portfolio value in grams of 18K gold, including a chart,
  month-over-month table, short trend analysis and a downloadable Excel workbook.
- Publish the generated history workbook to the owner's OneDrive `اسناد` folder
  through a separate, restricted write authorization.
- Manage owner, admin, financial-advisor and guest roles with approvals,
  promotions, revocations, silent expiry and access-time extensions.
- Notify admins when a non-admin uses a report, while excluding raw inputs,
  prices and private notes from the activity notification.
- Fail closed when quantities, prices, permissions or freshness checks are
  incomplete, rather than showing misleading totals or percentages.

The complete feature catalog, including commands and permissions, is in
[docs/FEATURES.md](docs/FEATURES.md).

## Data flow

```text
OneDrive Trading Journal.xlsm (read only; 23 named-table totals)
        ↓ verified Microsoft Graph worker
authenticated production sync + exact protected readback
        ↓
private Vercel Blob snapshot + six separately managed holdings
        ↓ independent current market prices
access-controlled Telegram text, image and chart reports

Separate monthly reconstruction
        ↓
private history state → verified Excel → OneDrive اسناد
```

The workbook is authoritative for 23 quantities. The private Vercel snapshot is
a cache, and the six manual holdings change only on the owner's explicit
instruction. Market values never come from workbook price cells.

## Telegram reports

| Menu item | Command | Purpose |
| --- | --- | --- |
| آخرین ترکیب دارایی | `/latest_allocation` | Choose a detailed Persian pictured or text allocation report |
| دارایی‌ها | `/assets` | Categorized current quantities |
| طلا و سایر فلزات گرانبها | `/gold_and_other_precious_metals` | Precious-metals valuation; `/gold` remains an alias |
| رمزارز | `/crypto` | Crypto quantities and live valuation |
| دلار نقدی | `/cash_dollar` | Cash-dollar valuation; former commands remain aliases |
| نمودار ترکیب دارایی | `/allocation_chart` | Persian 3D-style group-percentage chart |
| روند ارزش بر حسب طلا | `/gold_history` | Monthly portfolio value in grams of 18K gold |
| وضعیت | `/status` | Stored snapshot diagnostics and timestamps |
| پنل مدیریت | `/admin` | Access, role and operational controls for owner/admins |
| راهنما | `/help` | Current command help and reusable menu |

Legacy `/allocation` and `/refresh` open the latest-allocation workflow. Report
requests synchronize quantities first, then retrieve market prices. A failed
refresh never substitutes an older cached report.

## Access model

| Role | Access |
| --- | --- |
| Owner | Full reports, history Excel and all administration; unlimited access |
| Admin | Full reports, history Excel and delegated administration; unlimited access |
| Financial advisor | Financial reports and gold-history chart/text; no administration or Excel download |
| Guest | Redacted allocation percentages only; no portfolio total or notes |

Guest and financial-advisor grants expire after seven days unless an admin
extends them by one, three or seven days. Expiry and extensions are silent to the
affected user. Expired memberships are removed and require fresh approval.

## Reporting and valuation safeguards

- Current reports require complete, fresh quantities and trustworthy prices.
- EcoCoach `بلک راک` is the Iranian private fund, never foreign BlackRock Inc.
  The bot tries the EcoCoach website and asks for a unit price when necessary.
  A fixed fallback is allowed only for the owner's guest-chart exception.
- Ordinary report rows valued below 50,000 toman are removed from rows, notes,
  totals and percentages after complete input validation.
- Toman amounts are rounded only for display. Underlying calculations and asset
  quantities keep their precision.
- All user-facing timestamps use the Persian calendar and Tehran time.
- Historical asset comments are visible only to owner/admins. Advisors receive
  only the short EcoCoach description; guests receive no notes.
- Every report delivery rechecks the current role and access expiry.

## Monthly history

The history report reconstructs actual Persian month-end quantities and dated
prices, then expresses complete portfolio value in grams of 18K gold. It keeps
completed months protected, updates the current month provisionally and labels
authorized carried prices as estimates using their real quote dates. It is a
wealth series, not a cash-flow-adjusted investment return.

The chart labels every month and uses readable rounded y-axis intervals. The bot
also sends a concise Persian trend summary and a month/value/change table. Admins
can download the five-sheet Excel report; a separately authorized worker publishes
the managed file to OneDrive and verifies the downloaded hash.

See [docs/GOLD_HISTORY.md](docs/GOLD_HISTORY.md) for the reconstruction rules,
source exceptions, owner decisions and archive behavior.

## Administration and monitoring

The admin dashboard supports pending-request review, approval with role choice,
promotion/demotion, revocation, remaining-access monitoring, one/three/seven-day
extensions, storage checks, recent access audit and return to the main menu.
Hourly maintenance removes expired non-admin grants with conditional-write
protection against concurrent changes.

See [docs/ADMIN_DASHBOARD.md](docs/ADMIN_DASHBOARD.md).

## Automation and deployment

- Vercel hosts the Telegram webhook and private application state.
- GitHub Actions runs regression tests, on-demand OneDrive synchronization,
  monthly history processing, OneDrive report publication, source audits,
  Microsoft reauthorization and hourly expired-access maintenance.
- The production `main` branch is protected: changes require a pull request, an
  up-to-date passing `test` check, resolved conversations and linear history.
  Administrators cannot bypass the rule; force pushes and deletion are blocked.
- The source workbook credential is read-only. Report publication uses a separate
  write credential and is restricted to the managed report.
- Production writes require authenticated callbacks and exact protected readback.
- Public workflow output contains aggregate diagnostics rather than holdings,
  prices, user identifiers or credentials.

Production service: `https://portfolio-agent-telegram.vercel.app/api/telegram`

Telegram: `@SaRoPortfolioAgentBot`

## Development

Use Node 24 and Python 3.12.

```sh
npm install --package-lock=false --no-audit --no-fund
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements-sync.txt
node --experimental-vm-modules --test tests/*.test.mjs
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

Every feature change must update the user-facing feature catalog and the relevant
topic/runbook documentation in the same pull request. A feature is not complete
until its behavior, permissions, data sources, failure behavior and operational
impact are documented and verified.

## Documentation map

- [docs/FEATURES.md](docs/FEATURES.md) — complete current feature catalog
- [AGENTS.md](AGENTS.md) — mandatory development, data-integrity and documentation rules
- [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) — current model-independent takeover brief
- [docs/CODEX_HANDOFF.md](docs/CODEX_HANDOFF.md) — original architecture, mapping and historical setup
- [docs/CODEX_RECOVERY.md](docs/CODEX_RECOVERY.md) — recovery in a new environment or AI session
- [docs/LATEST_ALLOCATION.md](docs/LATEST_ALLOCATION.md) — fresh synchronization and allocation formats
- [docs/BOT_MENU.md](docs/BOT_MENU.md) — menu, presentation and formatting
- [docs/ADMIN_DASHBOARD.md](docs/ADMIN_DASHBOARD.md) — access control and monitoring
- [docs/GOLD_HISTORY.md](docs/GOLD_HISTORY.md) — monthly history and Excel export
- [docs/ECOCOACH_PRICING.md](docs/ECOCOACH_PRICING.md) — EcoCoach price identity and fallback rules
- [docs/ONEDRIVE_VERIFICATION.md](docs/ONEDRIVE_VERIFICATION.md) — read-only source verification

For Codex, Claude Code or another development assistant, begin with
[docs/AI_HANDOFF.md](docs/AI_HANDOFF.md). Build a private offline handoff with:

```sh
python3 scripts/build_ai_handoff.py --output-dir /path/outside/repository
```

The handoff contains historical financial documentation and must remain private.

## Security

Never commit credentials, OAuth tokens, private Blob records, raw workbooks or
generated private reports. Never create an anonymous OneDrive share. Keep service
secrets in their managed stores and preserve TLS, webhook, access, timestamp,
quantity, ETag and readback validation. The repository documents credential names
and recovery procedures, not secret values.
