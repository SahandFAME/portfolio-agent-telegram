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

On 2026-10-27 the owner confirmed/corrected BTC and Link dates to day/month/year.
Interpret year-last text dates as day-first for those two assets only, including
four-digit Gregorian or Solar Hijri years. Native Excel dates and year-first
dates retain their existing meaning. Invalid, compound and two-digit-year text
still fails; other assets do not inherit an unconfirmed date convention. After
parsing, net quantities and nonnegative reconstructed balances must still pass.

The owner subsequently corrected Tether dates to the same day/month/year format
and explicitly requested ignoring the `هزینه گم شده` cell. Exclude a Tether
transaction row only when its date cell exactly matches that label after Persian
letter/whitespace normalization; do not match substrings, other cells or assets.
Exclude its quantity from both dated trades and the reconciliation net. Keep the
authoritative current total unchanged and reject historical quantities if the
remaining trades fail to reconcile. This does not assign a date to an undated
adjustment, change the live holding or waive other date/balance errors.

On 2026-10-28 the owner explained that Tether's total excludes the opening
trading-capital row and a gas-related deduction documented in the total-cell
comment. Recognize only the exact verified `SUBTOTAL(109,table[Quantity]) -
firstQuantityCell - numericFee` shape, with a matching capital/fee comment,
a valid pre-window opening date and no hidden transaction rows. Never execute
or broadly evaluate Excel formulas. Exclude the reserved opening capital from
portfolio history. For current-balance reconciliation only, include the signed
ignored-note adjustment and subtract the documented fee. Their dates are still
required for weekly history: a fully explained current total does not establish
when an expense affected the portfolio. Record unknown timing as explicit
private exceptions rather than an unexplained quantity mismatch or an invented
transaction date. Unrecognized formulas, comments or residuals still fail closed.
For this reserve-excluded basis, validate the opening balance at the start of the
requested year and all subsequent daily balances; an earlier out-of-window deficit
does not establish a deficit within the requested year. Opening or in-window
negative balances still block history. Other assets retain their existing checks.

The owner subsequently confirmed both documented deductions occurred before
the analysis period. Apply their combined signed amount to the opening balance
and every requested weekly quantity, with no invented transaction date. Bind this
confirmation to the inspected capital/fee/ignored-adjustment signature; changed
amounts require new timing confirmation. Include the opening adjustment in
nonnegative balance validation. Current source totals remain unchanged.

On 2026-10-28 the owner accepted values below USD 5 as immaterial for historical
valuation. Backfilled weeks exclude each priced asset below USD 5 from rows,
totals and percentages, using that week's independently dated USD/IRR quote and
retaining the existing 50,000-toman minimum. Exactly USD 5 remains included.
Missing, future or stale prices/FX still block a complete valuation; raw quantities
and the authoritative current source total remain unchanged. Live reports and
weekly live observations keep their existing cutoff.

The owner showed ADA's total formula suppressing quantities below one unit.
Its fully dated, nonnegative transaction history may be used when the discrepancy
against the current total itself is independently proven worth less than USD 5
at that week's historical ADA/USD price. Do not erase earlier material ADA
holdings, invent a fee/sale date, or ignore date/negative-balance failures. A
week without this proof remains unknown. This reconciliation exception is scoped
to inspected ADA; other outstanding balances still require their own review.
ADA's year-last Solar Hijri dates use the day/month/year order shown in the
owner's Excel evidence. No other asset inherits that date convention.

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
Verified individual asset values remain available in the asset sheet when
another asset blocks a week's total. Unknown asset values stay blank; incomplete
weeks still have no portfolio total, gold-equivalent value or group percentages.

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

For owner-requested formula/comment inspection, the read-only audit workflow can
accept an optional public encryption certificate. Its narrow inspection script
reads the requested total and opening-row information without saving the source;
only CMS-encrypted diagnostics enter a public check. The requesting Codex session
keeps the temporary private key outside the checkout and decrypts locally.
No raw formula, comment, holdings, source file or token belongs in public logs.

## Owner-selected OneDrive destination (2026-10-25)

The owner requested the generated workbook in **اسناد** in the same personal
OneDrive account. Publish only **اسناد/Portfolio-18K-Gold-History.xlsx**. The
historical data gaps remain; choosing a destination does not validate missing
weeks. Private Blob remains the report source and admin download mechanism.

`onedrive-history.yml` runs after a successful main-branch history export or
Microsoft consent, and supports manual dispatch. Until separate upload consent
exists its upload steps explicitly skip. No OneDrive upload is proven by a
successful skipped job. Once configured, the uploader checks the exact drive,
literal folder name, parent identifiers and report filename, then verifies a
downloaded SHA-256 against the current private export. It refuses an unrelated
workbook collision. Generated reports carry the document identifier
`portfolio-agent:18k-gold-history:v1`. Existing report updates use `If-Match`;
new uploads request conflict rejection. No write retries follow ambiguous upload
failures. Re-running verifies a completed identical upload without rewriting it.
Revision changes fail rather than claiming an obsolete report is current.

After verified publication, save the managed report item ID in repository secret
`ONEDRIVE_GOLD_HISTORY_REPORT_ID`. Some Excel clients remove the document's custom
identifier on save; a missing identifier is acceptable only for this exact managed
item in the verified drive/folder, with the expected report structure and no
macros. Another item with the same filename is not accepted. Before an item ID
has been saved, one-time recovery may supply `previous_report_fingerprint` to the
publication workflow. Compute it from the preceding private generated report;
all worksheet names and cell contents must match, independent of ZIP metadata
and formatting. Changed contents fail without a write. Save the managed ID only
after the newly uploaded report passes downloaded-hash and revision checks.

The original `MS_GRAPH_REFRESH_TOKEN` remains dedicated to read-only source
retrieval and explicitly requests `Files.Read` at refresh, including after a
second consent for the same app. Separate delegated `Files.ReadWrite` consent
saves **MS_GRAPH_EXPORT_REFRESH_TOKEN** through the existing secret-writer PAT.
Microsoft's personal-account permission covers the account's files; code limits
the exporter to the report in اسناد. It is not a Microsoft-enforced folder-only
permission. App-folder permission cannot target an arbitrary existing folder.
No anonymous share, Trading Journal write, source-cache change or replacement
of the existing sync credential is authorized by this export.

For sign-in, Codex generates a temporary RSA public/private key pair outside
the checkout, dispatches `microsoft-consent.yml` with `purpose=report_export`
and the base64-encoded **public** PEM in `signin_public_key`. The workflow
publishes RSA-OAEP/SHA-256 encrypted short-code instructions in a check;
Codex decrypts them locally and gives the owner Microsoft's official sign-in
address and code. Neither the raw user code, OAuth device code nor tokens enter
public export-consent logs/checks. Keep the private key local with mode 0600 and
remove it after consent/expiry. The owner must complete Microsoft consent;
source access alone cannot grant this write permission. Refresh-token rotation
uses the separate secret and report-export concurrency group.

Verification requires an actual configured upload and hash readback, not just
unit tests, consent completion or workflow deployment. Existing private report
generation continues when OneDrive upload is awaiting consent or fails.
