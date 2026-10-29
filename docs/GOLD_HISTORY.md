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

The owner-selected grid now contains 52 Wednesdays, 2025-10-29 through 2026-10-21. Reconstruct
only signed, dated trades whose net quantities reconcile to the verified current
table totals and whose end-of-day running balances are nonnegative. Excel dates,
full Solar Hijri dates and unambiguous Gregorian strings are supported. Never
guess ambiguous month/day order, malformed/multiple dates, undated costs, missing
opening balances or unexplained quantity discrepancies. Such assets stay unknown,
not zero. Additional unmapped trade tables are flagged unless they are explicitly
closed, reconciled and entirely before the historical window. Source table and
row locators appear in the private workbook exceptions sheet.

The read-only source audit identified two additional tables relevant to the
historical calculation: XAUT (Tether Gold, quoted in USD per token) and اهرم
(listed fund units, quoted in rial per unit). Their current subtotals reconcile
with their dated transactions. Historical calculations now retain these in a
separate `additional_quantities` field rather than limiting past holdings to
today's configured 29 assets. Validate exact table/sheet/header identity, the
structured subtotal formula, finite nonnegative current balance, full dated net,
visibility and nonnegative historical balances. Missing/changed tables remain
unknown and block complete totals; a current zero does not erase earlier units.

The protected history configuration declares the two required additions. The
server independently validates them, applies the same cutoff, includes their
values in totals and gold/share group percentages, and counts their quantity
changes. Excel lists individually verified additions even if another missing
price prevents a portfolio total. Weekly source captures reread both subtotals
and supply independently dated quotes; an old worker omitting them produces an
incomplete observation. Source values, macro workbook and the existing 23-asset
sync contract and six manual holdings remain unchanged. Other bot reports retain
their configured current asset list.

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
week without this proof remains unknown. The owner subsequently confirmed the same small-balance convention for SOL,
ONDO and Link. Apply the same strictly-below-USD-5 discrepancy bound to these
four assets only. Link already reconciles in the inspected source; do not change
its quantities or formula. Other outstanding balances still require source review.
ADA's year-last Solar Hijri dates use the day/month/year order shown in the
owner's Excel evidence. No other asset inherits that date convention.

The owner explicitly instructed ignoring the inspected MATIC remainder as worth
less than USD 5. This is an owner-directed materiality exclusion, not a claim
that every historical MATIC price was independently available or that an expense
occurred on an invented date. Exclude only the identified MATIC table with the
confirmed remainder signature, exact subtotal-minus-remainder formula, matching
transaction net, no hidden rows, valid nonnegative dated transactions entirely
before the analysis period and no nonzero current total. Changed amounts,
identity, formula, dates or an in-period transaction restore the review flag.
Other unmapped assets remain unresolved; the current 23+6 holdings are unchanged.
MATIC year-last text dates use the owner's confirmed day/month/year convention;
this does not waive malformed dates or extend that parser rule to other tables.

Historical crypto backfills may recover already verified CoinGecko USD evidence
from a persisted historical conversion when the provider is unavailable. Require
the original CoinGecko/TGJU provenance, positive finite rial and FX prices, and
both original quote timestamps at/before the historical observation within seven
days. Recover USD by reversing that recorded FX conversion; never substitute a
live quote or reuse a cached quantity. Fresh provider evidence wins at the same
timestamp, and quantities/remaining discrepancies are checked anew against the
fresh source. Aggregate runs count dust candidates and accepted asset-weeks so a
successful export cannot hide an unprocessed balance.

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

Listed fund/share archives now also use Shakhesban's published historical trade
table, on the same rial-per-unit basis as the existing current-price adapter.
Verify the JSON-LD ticker, instrument type and canonical provider path before
decoding the server-rendered history payload as JSON; never execute webpage
scripts. Use the published `close_price` column (پایانی), not `real_close_price`,
NAV, chart returns or a current quote. Require valid dated positive prices with
positive trading volume/count and reject conflicting duplicate days. Full-page
requests use HTTPS, no redirects/credentials, an eight-second timeout and a
five-MiB limit. TSETMC remains an independent fallback. Persisted, previously
verified rial history may survive a provider outage with its original source
and timestamp; fresh source quantities are still recomputed. Trading gaps longer
than seven days remain unknown, rather than silently carrying old closes.

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
not historical Wednesday closes.

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

`gold-history.yml` runs **Wednesday 23:30 Asia/Tehran** (Wednesday 20:00 UTC).
The actual observation time is recorded, not presented as an exact midnight close.
Capture is restricted to Wednesday after 20:00 Tehran; a run delayed into Thursday
fails rather than relabelling Thursday quantities and quotes as Wednesday;
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
only CMS-encrypted diagnostics enter a public check. The narrow review also covers confirmed crypto dust totals and nearby labels
of unmapped trade tables, to identify historical assets without screenshots.
All such information remains encrypted. The requesting Codex session
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


## Wednesday calendar and confirmed wartime closures (owner request, 2026-10-28)

The initial annual reconstruction uses 52 Wednesdays, 2025-10-29 through
2026-10-21. Each Wednesday's quantities are reconstructed from its own dated
trades; never relabel the old Friday balances or use later trades/prices.
2026-10-28 is the next scheduled observation, not a completed historical week
at the time of this change. The actual late-Wednesday capture time is retained.

The owner explicitly authorized last-open-market closes during verified wartime
closures. The shared, reviewed allowlist is `lib/iran-market-closures.json`:

- Equity/share funds: closure begins 2026-02-28; general trading resumed
  2026-05-19. Carry the actual 2026-02-25 closing quote through 2026-05-18 only.
- The seven configured gold/commodity funds resumed on 2026-03-15 in their
  published transaction archives. Their allowed interval ends 2026-03-14.
  Never extend the equity closure across weeks when these funds traded.

Evidence: the public Google News index identifies Reuters' 2026-05-16 report
“Iran's stock market to reopen on Tuesday, official says”, and independent
2026-05-19 reports of reopening after an 80-day closure. Its exact indexed
article URL is retained in the allowlist. Direct Reuters retrieval returned
401, so this is independently indexed reporting, not a downloaded official
exchange holiday calendar. Public Shakhesban transaction archives separately
show the actual last pre-closure session (2026-02-25), equity reopening on
2026-05-19 and all seven commodity-fund resumptions on 2026-03-15. The public
2026 Iran war account dates the start to 2026-02-28; a ceasefire date alone is
not evidence that exchange trading resumed. The June 2025 conflict precedes
the owner-confirmed annual window and creates no carry interval here.

Both Python selection and the server require the exact allowed asset, valuation
date interval, last-open date, positive finite price and verified historical
IRR closing-price source. The server derives closure metadata itself. No future
quote, differently dated old price, owner price, NAV, crypto, USD/IRR, physical
gold denominator, coin or EcoCoach quote receives this exception. SilverBar
reopening coverage is not established by the equity/fund evidence and remains
unresolved until an exact dated certificate archive is obtained. Individual
halts after general reopening remain gaps pending their own evidence.

Excel retains the actual price timestamp and adds explicit pricing-basis and
closure-ID columns. Its analysis sheet explains the Wednesday calendar and
closure method. Normal seven-day freshness remains outside these intervals.
All financial arithmetic, quantity reconciliation, historical $5 cutoff and
incomplete-total safeguards remain intact.

Migration requires an authenticated, revision-matching full 52-Wednesday batch
with `calendar: wednesday-v1`. The server validates/calculates the entire batch,
then saves the untouched original Friday state to an immutable private calendar
archive before its conditional replacement. It preserves existing Wednesday
observations and their complete-record protection. The archive includes the
original revision; the prior revision's private Excel remains stored. Failed or
partial migration must leave the current state intact. The report pointer still
requires a regenerated matching-revision Excel and downloaded OneDrive hash check.

## Owner price inputs and temporary last-known policy (2026-10-29)

The owner supplied a private text checklist with dated numeric prices and asked
that unresolved prices use the latest known price for now. This supersedes the
closure-only freshness exception for the gold-history report, not normal current
bot valuations. No actual prices or source document are committed to GitHub.

`scripts/import_history_prices.py` parses only known asset headings and numeric
rows, verifies matching Gregorian/Persian Wednesday dates, skips blanks and the
literal closure status, rejects malformed/duplicate rows and requires explicit
currency. It never executes attachment text. Convert confirmed toman/unit values
to IRR once, retaining original currency/amount, actual quote date and attachment
SHA-256. Dry-run output contains aggregate counts only; `--apply` requires the
existing sync credential and verifies private readback.

The protected `POST ?sync=gold-history-prices` route requires current revision,
validated asset/unit/date/amount fields and the explicit policy identifier
`last-known-before-valuation-v1`. It merges dated owner inputs into the private
history state, creating a separate input revision. All normal history writes
preserve these fields. Inputs are not part of the public configuration or user
report download endpoints; the full history endpoint retains sync authentication.

Historical reconstruction always rereads Trading Journal. It selects the latest
available IRR/unit evidence on or before each valuation. Same-day owner entries
win over provider quotes; later provider dates supersede earlier owner dates.
An unknown quantity is still unknown, and absence of any earlier price still
blocks a total. Gold/FX dates also remain real; no forward price or today's
quantity may be backdated. Server recomputation derives `owner_authorized_last_known`
metadata from the saved policy and original timestamps, never from untrusted
client flags. The reviewed closure label remains separate where applicable.

The server also fills missing quotes in an already source-verified weekly live
observation from dated earlier history/owner inputs; it keeps that observation's
own holdings, workbook identity/check time and actual capture time. Regular live
bot reports retain their freshness rules. Weekly EcoCoach requests still occur
if only an estimated older fund price is available, and an admin reply can replace
that estimate. Backfill/import does not send activation messages or price prompts.

`estimated_assets` and `valuation_basis: estimated_last_known` distinguish
computable estimates from dated prices. Excel marks estimated rows/weeks,
retains actual price timestamps and uses computed/estimated rather than verified
labels in analysis. The Telegram chart identifies estimated history. Estimated
complete weeks can upgrade when actual prices arrive; an incomplete rebuild
cannot erase a previously computable record. A new private input revision permits
explicit owner corrections to completed historical prices. Existing immutable
protection still applies to complete observations outside this controlled path.

## Persian monthly history and text summary (owner request, 2026-10-29)

This supersedes the weekly calendar and weekly presentation above. The initial
completed grid is 12 Persian month ends inside the confirmed manual-holdings
window: 1404/08 through 1405/07 (2025-11-21 through 2026-10-22). Do not extend
the manual baseline to the preceding Mehr close, which predates the owner's
confirmed interval. The first month has no prior-month comparison. Subsequent
completed months are appended; a current-month observation uses fresh verified
current source totals, its real observation timestamp and a provisional label.

Historical quantities come from dated transactions at each actual month end;
prices use independent daily archives and the saved owner/last-known policy.
This is not a sampled or averaged weekly chart. The denominator is the 18K-gram
quote for the same valuation, with original timestamps and estimate labels.
The $5 historical cutoff, dated FX and known-quantity validation apply consistently
to closed and provisional monthly observations. Normal live bot reports retain
their existing cutoff/freshness behavior.

The active calendar is `persian-month-end-v1`. For compatibility, private route,
function and storage field identifiers such as `weeks`/`week_ending` remain; each
active record explicitly carries `period_kind: monthly`, a validated `month_key`
and actual Persian month-end Gregorian key. Initial migration requires the full
12 reconstructed dates, archives the original weekly state privately, preserves
all owner inputs, and retains deduplicated dated price evidence. This includes
later admin quotes that would otherwise disappear when their weekly rows are
archived. Only evidence at or before each target date can be selected. Existing
monthly history cannot be rolled back to weekly input batches.

Monthly deltas and percentages compare adjacent Persian months, not fixed 7/30
days. Missing/incomplete intervening months break comparisons and chart lines.
A provisional point may compare with the previous closed month, but is explicitly
labelled provisional in Excel, chart and text. Repeated provisional observations
can update. A month-end live capture remains provisional until a fresh historical
reconstruction finalizes its actual closing date; complete finalized records keep
financial integrity protections and can upgrade estimated prices.

The scheduler checks the Persian calendar at 22:00 Tehran daily. It reads Graph
and captures only on the last Persian day; on day 1 it reconstructs the now-ended
month using complete daily prices/transaction history. Other days return an
explicit skip before Graph access or export. The OneDrive workflow skips these
non-report schedule checks. Manual bootstrap/backfill/export operations remain
available. Month-end delays into a different day cannot relabel current quotes.
EcoCoach requests refer to the recorded monthly observation and can replace a
last-known estimate; bootstrap/backfill does not broadcast test/activation prompts.

The managed report keeps its filename, document identifier, folder and five-sheet
structure. The first sheet is now `ارزش ماهانه`, with value in grams of 18K gold,
month-over-month gram and percentage changes, whole-toman valuation and original
observation/source-check times. The exporter accepts the old weekly sheet identity
only to verify and safely replace the existing managed workbook during migration.
It never edits Trading Journal or creates an unrelated OneDrive file.

The Telegram `/gold_history` menu/help/report are monthly. Each response sends
the chart and a short Persian text preserving the approved start/latest/net,
minimum/maximum and direction summary, followed by rows for every month with
value, signed change in grams and signed percentage change. The first or
non-adjacent month displays a dash; no invented comparison. Dates/month keys are
bold in Tehran/Persian calendar, current observations and last-known estimates
are marked, and the message stays within Telegram limits for the annual report.
Report readers are rechecked after image rendering and before text. Only current
admins receive Excel/price controls; guests receive no history data.
