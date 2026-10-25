# Weekly portfolio wealth in 18K gold

The portfolio's **reported total rial value / rial price of one gram of 18K gold**
is a wealth measure in grams, not a deposit-adjusted investment return. The
owner requested the preceding year and ongoing weekly observations on 2026-10-25.

## Source and reconstruction

Trading Journal.xlsm stays read-only and authoritative for the 23 mapped current
quantities. The existing total-row, file-identity, archive/XML and stable-eTag
checks remain. The six manual quantities are owner-confirmed unchanged during
2025-10-25 through 2026-10-25. Persist their original baseline with the history;
later manual edits must not rewrite the confirmed historical year.

The initial grid contains 52 Fridays, 2025-10-31 through 2026-10-23. Reconstruct
only signed, dated trades whose net quantities reconcile to the verified current
table totals and whose end-of-day running balances are nonnegative. Excel dates,
full Solar Hijri dates and unambiguous Gregorian strings are supported. Never
guess ambiguous month/day order, malformed/multiple dates, undated costs, missing
opening balances or unexplained quantity discrepancies. Such assets stay unknown,
not zero. Additional unmapped trade tables are flagged unless they are explicitly
closed, reconciled and entirely before the historical window. Source table and
row locators appear in the private workbook exceptions sheet.

BlackRock is zero before its recorded first purchase, consistent with the owner's
confirmed launch/purchase explanation. It needs no fabricated pre-launch price.
After purchase it requires an evidenced historical price; a current website quote,
purchase cost or the guest-only fixed fallback must never substitute for one.

Historical price adapters use TGJU daily closes in rial, exact-symbol TSETMC
instrument identities and official daily market prices, and CoinGecko USD history
converted with the independently dated USD/IRR history. Do not substitute physical
silver spot for the user's silver certificate. Unsupported instruments stay
unpriced. Optional archive requests have an eight-second timeout and three-worker
concurrency; their failures become missing quotes without delaying Graph auth or
overwriting good data. Workflow outcomes publish aggregate status/coverage only. Select observations at or before the valuation time, no older than seven
days; never forward-fill across an unverified trading/holiday gap.

Validate all quantities and required positive-quantity quotes before applying the
owner's 50,000-toman asset cutoff. Incomplete weeks have no total, gold-equivalent
value, group percentages or claimed weekly return. Charts leave real gaps.
Weekly changes require consecutive complete weeks. Quantity-change counts are
unknown when either week's quantities are incomplete.

## Private persistence and Excel

Private Blob `portfolio/gold-history/latest.json` contains the versioned manifest,
source workbook SHA-256/modified/checked times, quantities, normalized rial quotes,
source timestamps, issues, totals and allocations. Conditional writes and revision
checks prevent stale workers from overwriting another update. Verified observations
are immutable to backfill; a provisional current baseline can be replaced by its
subsequent official weekly observation. Baseline points are labelled provisional,
not historical Friday closes.

A newly generated `Portfolio-18K-Gold-History.xlsx` contains weekly values/deltas,
qualifying asset rows, allocations, source exceptions and an analysis/coverage
summary. Its real Excel line chart uses blank gaps. Money displays whole toman;
quantity arithmetic retains precision. Timestamps use bold Solar Hijri dates and
Tehran time. Formula-like text is escaped and no source macros are copied.

Regenerate the same logical workbook from the accumulated manifest; private
revision files preserve prior exports. The pointer must match the current data
revision. Export uploads are hash-checked by authenticated binary readback. Never
serve a stale Excel file as current. Never commit an XLSX report or raw source
workbook, publish an anonymous URL, or put financial records in workflow logs.

Protected API routes (same sync-secret boundary as existing operations):
- GET `?data=gold-history`, `gold-history-config`, `gold-history-file`.
- POST `?sync=gold-history`: authenticated historical batches only, fixed manual
  baseline and expected revision; the server recomputes financial values.
- POST `?sync=gold-observation`: fresh verified 23-asset source plus server-side
  manual holdings and live market quotes; no write to the bot's quantity cache.
- POST `?sync=gold-history-file`: current revision and newly generated XLSX only.

## Weekly operation and Telegram

`gold-history.yml` runs **Saturday 00:30 Asia/Tehran** (Friday 21:00 UTC), after
Friday's end. The actual observation time is recorded; scheduler delays are never
presented as an exact midnight close. Capture is restricted to Friday/Saturday;
a manual initial bootstrap creates a clearly provisional current observation.
The workflow shares the existing Microsoft consent concurrency group to protect
refresh-token rotation. Export-only jobs use a separate group and no Graph login.
The source workbook is checked anew before each capture. Existing daily/ChatGPT
and on-demand quantity sync are not retired, rescheduled or replaced.

At each weekly capture the server checks EcoCoach first. If no usable unit quote
exists, it saves an incomplete week and asks **current admins only** for a price,
with the observation timestamp in the prompt. Replying to that exact prompt
attests the unit price for that recorded time, avoiding interference with an
allocation price prompt. Late replies must refer to the displayed historical
time, not silently substitute today's price. Recheck admin permission and use a
conditional update. The chart updates immediately; an export-only workflow then
regenerates the Excel file. If other data is missing, the week stays incomplete.
Only a real weekly capture sends automatic prompts; bootstrap/backfill trials
must not broadcast requests.

Menu **روند ارزش بر حسب طلا** / `/gold_history` is available to owners, admins and
approved active financial advisors. Guests cannot obtain the image, history data,
Excel or price controls through typed/forged requests. Recheck permissions before
delivery. Chart images use bundled Estedad, Persian labels and Tehran timestamps.
Admins alone receive Excel-download and pending-price buttons. The report has
no private historical asset comments; advisors receive no admin controls.

## Verification and known data exceptions

Local regression tests cover actual Excel generation/reopening, chart gaps,
rounding, source immutability, date ambiguity, reconciliation, launch dates,
quote freshness/units, role isolation, website/manual pricing, revisions and
binary readback. Production API readback and a manually triggered workflow prove
those paths, not a future scheduled run or a live Telegram chat interaction.

The initial source audit found unresolved crypto date/reconciliation issues and
additional trade tables requiring scope review. A populated weekly grid is not
proof that the historical totals are calculable. Report actual complete-week
coverage and request dated corrections/verified historical instrument prices
when needed. Do not claim the requested year is fully reconstructed while gaps
remain. Public workflow diagnostics are aggregate-only; detailed records belong
in private Blob and the admin Excel file.
