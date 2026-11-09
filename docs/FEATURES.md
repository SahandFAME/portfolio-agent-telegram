# Portfolio Agent — current feature catalog

This document describes the behavior that is currently implemented and supported.
It is the canonical user-facing feature catalog for maintainers and reviewers.
Historical design decisions and detailed operating procedures remain in the topic
documents linked from the README.

## Portfolio data and synchronization

- The current portfolio contains 29 assets. Twenty-three quantities come from
  named current-total cells in the read-only OneDrive `Trading Journal.xlsm`;
  six holdings are managed separately and may change only on the owner's explicit
  instruction. Two additional assets exist only in historical reconstruction.
- Every asset, category, allocation and history report starts a fresh OneDrive
  quantity synchronization. Help, status and format-selection screens do not.
- The sync worker verifies workbook identity, all 23 expected assets, finite and
  nonnegative quantities, timestamps, authenticated production writes and exact
  protected readback. A failed refresh cannot silently fall back to old quantities.
- Report callbacks are tied to an opaque request, synchronized snapshot and user.
  Replayed, stale or superseded callbacks cannot deliver a report. If an EcoCoach
  price is entered later, the bot synchronizes quantities and prices again.
- `/status` reports stored snapshot diagnostics. It does not claim to be a live
  valuation and distinguishes source file modification time from sync-check time.

## Telegram menu and report delivery

- The reusable Persian keyboard puts **آخرین ترکیب دارایی** first as the primary
  button and exposes assets, category reports, allocation chart, history, help and
  role-appropriate administration.
- `/latest_allocation` opens a submenu for a Persian pictured report or a detailed
  text report. `/allocation` and `/refresh` remain compatibility aliases.
- Temporary progress notices and EcoCoach prompts are removed after a successful
  next response. Admin screens replace the preceding panel and include a return to
  the main dashboard/menu.
- Permission and expiry are rechecked immediately before every text chunk, image,
  chart or file. A mid-report role change cannot disclose the remaining output.
- New users see a short Persian introduction, request access and wait for an admin
  to approve them with a role.

## Asset reports

- `/assets` lists current quantities under formatted asset categories.
- `/gold_and_other_precious_metals` (and `/gold`) values gold, coins, physical
  holdings and the exact SilverBar certificate. طعام and نهال are excluded because
  they are funds rather than precious-metal holdings.
- `/crypto` produces tidy numbered blocks with quantity, group, toman value, unit
  quote, source and timestamp.
- `/cash_dollar` reports دلار نقدی; legacy cash labels remain aliases.
- Ordinary report rows worth less than 50,000 toman are removed from rows, notes,
  totals and allocation percentages after all inputs have been validated. An
  unknown value never qualifies as a small holding.
- Full-portfolio totals and percentages are delivered only when every required
  input is complete and valid.

## Allocation images and charts

- The pictured allocation report uses bundled Estedad Persian typography and
  Persian labels. BTC displays four decimal places and ETH three in the image.
- The text allocation report contains row number, asset, quantity, group and whole
  toman valuation, followed by a separate group-percentage message.
- `/allocation_chart` renders the selected navy style-B 3D-style chart with rounded
  slice edges, connected group labels and percentages.
- Guest output is redacted to allocation percentages: it contains no portfolio
  total, asset notes or other restricted details.

## Pricing and calculation integrity

- Market prices come independently from configured providers rather than workbook
  valuation cells. Each price retains source, units and quote time.
- Iranian EcoCoach بلک راک is never confused with foreign BlackRock Inc. The bot
  first tries the EcoCoach site, then asks for a current per-unit price. Only a
  guest chart may use the owner-authorized fixed 1,030,000 toman fallback.
- Receivable and Zarbod gold are grams of 18K gold and use direct per-gram pricing.
  SilverBar uses its exact listed 999.9 certificate unit. Crypto is quoted in USD
  and converted with an independent free-market dollar rate.
- Toman amounts are rounded to whole numbers only for presentation. Calculations
  preserve full precision. Persian and English numeric punctuation follow their
  respective locale conventions.
- User-facing timestamps use the Persian calendar, Tehran time and bold report
  formatting.

## Notes and privacy

- Reports retain the short description of EcoCoach/BlackRock and original source
  workbook cell comments. Other generated notes are omitted.
- Original historical comments and their asterisks are visible only to owner and
  admins. Financial advisors may see only the short EcoCoach description. Guests
  receive no notes.
- Portfolio state, access records, report inputs and history evidence stay in
  private storage. Public logs and workflow summaries exclude holdings, prices,
  private user identifiers, raw workbook data and credentials.

## Roles, approvals and administration

| Role | Capabilities |
| --- | --- |
| Owner | All reports, Excel history and all administration; cannot be displaced |
| Admin | All reports, Excel history and delegated user/operational administration |
| مشاور مالی | Financial reports plus history chart/text; no admin or Excel download |
| Guest | Redacted allocation percentages only; no total valuation or notes |

- Admins approve a request as guest, financial advisor or admin. They can promote,
  demote or revoke users, while owner protections remain enforced.
- Guest and advisor access lasts seven days from approval. Admins can silently
  extend it by one day, three days or one week. Expired memberships are silently
  removed and require fresh approval.
- The monitoring dashboard shows remaining access time and provides extension
  controls, storage diagnostics, recent access audit and navigation back to the
  main menu.
- A non-admin report command sends current admins a sanitized activity notice.
  It excludes raw input, prices and report notes.
- Access records use conditional ETags and conflict retries so concurrent role
  changes, expiry cleanup and extensions do not overwrite one another.

## Monthly 18K-gold wealth history

- `/gold_history` measures the complete portfolio's Persian month-end value in
  grams of 18K gold. It is a wealth series rather than a cash-flow-adjusted return.
- Reconstruction reads dated source transactions and quantity rules for each
  month. It uses dated market evidence, owner-confirmed private inputs and only the
  documented last-known-price estimates when an exact old quote remains missing.
- Actual quote dates and estimate status are retained. Iranian market closures use
  reviewed last-open-session evidence; future prices are never moved backward.
- The documented historical sub-$5 reconciliation rule applies consistently.
  Completed months are protected; the current month remains provisional until it
  can be closed correctly.
- The bot sends a chart with every month on the x-axis, readable y-axis ticks, a
  concise Persian trend summary and a month/value/change table.
- Owner/admins can download the five-sheet Excel report. A separate restricted
  Microsoft authorization publishes the managed workbook to OneDrive `اسناد` and
  verifies its downloaded hash. Advisors receive chart/text only.

## Monitoring, automation and recovery

- GitHub Actions runs Node and Python regression tests for pull requests and main.
- Separate workflows provide on-demand source sync, daily Persian-calendar history
  checking, hourly access-expiry cleanup, source audits, Microsoft reauthorization
  and verified OneDrive report publication.
- Vercel hosts the Telegram webhook and private state. Production verification
  distinguishes a successful build from an authenticated API readback or an
  owner-observed Telegram response.
- `scripts/build_ai_handoff.py` creates a private, model-independent recovery
  package with current documentation, source, tests, workflows and Git history.
  The package intentionally excludes credentials and live private application data.

## Required documentation for every feature

Every new feature or user-visible behavior change must update this catalog, the
README and the affected topic/runbook in the same pull request. Document:

1. user and administrator behavior;
2. role access and every delivery-time authorization recheck;
3. data, price, private-state and credential-name dependencies;
4. freshness, failure, concurrency and privacy behavior;
5. commands, buttons, APIs, workflows and schedules affected;
6. automated tests and the production evidence that can actually be claimed; and
7. recovery steps or documentation-map changes future maintainers need.

Describe the final implementation rather than abandoned approaches. Never place
secret values, private holdings, owner prices, user IDs or raw workbook data in
public documentation. A feature is not complete until a reviewer can understand
and operate it from the repository without the original chat.
