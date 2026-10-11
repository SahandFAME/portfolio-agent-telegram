# Telegram report menu

## Introduction before Start

Telegram's public pre-Start bot description is stored in
[`config/bot-description.fa.txt`](../config/bot-description.fa.txt). It is set
for the default language and Persian, so clients in other languages also show
the owner's Persian introduction. It is visible before access approval and
contains no private holdings. The existing Start/access-request flow is unchanged.

With `TELEGRAM_BOT_TOKEN` provided securely in the environment, run
`python scripts/configure_bot_description.py --apply` to update it. The script
checks the bot identity and verifies both descriptions through Telegram readback.
Omit `--apply` for a read-only check. Never paste the credential in the command.
Description settings live at Telegram; a Vercel deployment alone does not update
them. This script sends no chat messages and does not change the bot's name,
short description, webhook or approval state.
Telegram controls the layout of this plain-text description. Its Bot API
offers no text-alignment setting, so centered introduction text cannot be
enforced across clients.

## Report buttons

In an authorized private chat, send `/start`, `/help` or `/menu` once to display
the report button keyboard. It also accompanies subsequent report replies
and images. If Telegram hides the keyboard, use the keyboard icon beside its
message field to reopen it.

The menu stays reusable after a selection (`one_time_keyboard: false`), while
`is_persistent: false` permits normal dismissal instead of asking Telegram to
keep it open. Phone Back and chat re-entry behavior are controlled by Telegram;
the bot receives no event when the user leaves or returns to a chat.

Admin screens include **بازگشت به منوی اصلی** to restore the report keyboard
without `/start`. One separate main-menu message supplies the reply keyboard
and survives temporary admin-screen cleanup. When another explicit main-menu
message is delivered successfully, it replaces the previous menu message;
financial reports and user messages are never removed as menu replacements.

| Button | Existing command |
|---|---|
| وضعیت | `/status` |
| دارایی‌ها | `/assets` |
| طلا و سایر فلزات گرانبها | `/gold_and_other_precious_metals` |
| رمزارز | `/crypto` |
| دلار نقدی | `/cash_dollar` (Cash Dollar) |
| آخرین ترکیب دارایی | `/latest_allocation` |
| نمودار ترکیب دارایی | `/allocation_chart` |
| راهنما | `/help` |
| پنل مدیریت (مالک و مدیران منتخب) | `/admin` |

Slash commands still work, including the `/gold` alias. `/cash`, the old
نقدینگی button text, and English `Cash Dollar` remain aliases for `/cash_dollar`;
the current button and report title are دلار نقدی. The old `/allocation` and
`/refresh` commands and the old آخرین تخصیص دارایی label open the latest-composition
submenu. Select **گزارش تصویری** or **گزارش متنی**, or use its return button.
Opening the submenu starts no sync or market retrieval. Choosing a format refreshes
OneDrive quantities, verifies the new snapshot, then fetches market prices. Buttons run through the
same private-chat access checks and quantity freshness checks as commands.
When asked for an EcoCoach price, type the current price in the message field;
other menu selections continue to work while that request is pending.

The selected format stays with the independent request and EcoCoach prompt.
The text report lists every asset's row number, exact quantity/unit, group,
value in toman, unit price and source. Complete asset blocks are sent in bounded
messages; a separate final message lists six category percentages from the same
valuation. A delivery failure, access revocation or superseding request stops
remaining text messages and percentages. Incomplete data produces no totals
or percentages.

The pictured report is Persian, with right-to-left table columns, Persian
digits, translated headings/units and the existing bold Solar Hijri/Tehran
timestamps. Standard crypto symbols and price-provider names retain their
recognized names. Bundled DejaVu regular/bold fonts support Persian shaping in
the serverless renderer; no host font installation or new service is needed.

**نمودار ترکیب دارایی** independently refreshes quantities and prices and
requests EcoCoach input through the same flow, then delivers a Persian 3D-style
pie chart. Its slice angles and percentage labels come from the complete current
toman valuation. It uses the same six categories/colors as the pictured report,
shows zero categories as 0% without drawing zero-size slices, and includes the
price and quantity-sync timestamps. Percentages are rounded to two decimal
places. No chart values are copied from the owner's reference image.

`/help` separates the EcoCoach explanation from the final command using real
blank lines, rather than displaying literal `\n` text.

Progress notices and EcoCoach price prompts are temporary. After the next text
reply or report image is confirmed delivered, the bot deletes the old notice.
Failed delivery preserves it; report messages, images and user input remain.
Only bot-created IDs are stored privately. Telegram cannot delete messages older
than 48 hours; temporary deletion errors are retried on a later successful reply.

The image table displays ETH quantities to three decimal places and BTC to four.
Only presentation is rounded; stored quantities and valuation arithmetic retain
full precision. Both 18K gold gram holdings use the live TGJU `geram18` quote.
The precious-metals report excludes طعام and نهال; both remain in the portfolio.

The assets report lists all 29 quantities once under Persian category headings:
gold and coins, silver, stocks and funds, crypto, Tether, and dollars. Each
category heading is bold, italic and underlined using Telegram HTML, with a
blank line before its asset list. It uses
the same classification as allocation: نهال and طعام stay with funds and Tether
has its own category. Quantities, zero balances and snapshot timestamps retain
their existing meaning; this command displays the cached holdings, without
requesting market prices or claiming a new OneDrive synchronization.

All displayed timestamps use the Solar Hijri (Persian) calendar, Persian digits,
24-hour time including seconds, and the `Asia/Tehran` time zone, explicitly labeled
تهران. Timestamp values are bold in status, assets, stale-data warnings, price
reports, admin status and access audit. The allocation image shows the same bold
price timestamp in its header and summary. Missing or invalid timestamps display
نامشخص. Internal snapshot, quote, request, API and audit timestamps remain UTC ISO
values; freshness comparisons and synchronization contracts are unchanged.

The [admin dashboard](ADMIN_DASHBOARD.md) is visible only to the configured
owner and chosen admins who still have approved portfolio access. The owner
selects them from the approved-user list and can remove their admin roles.

## Regression verification

Run `node --experimental-vm-modules --test tests/*.test.mjs` from the repository
root. The tests cover menu routing, access control, stale snapshots,
EcoCoach input, report-image precision and the precious-metal pricing fixes.
A successful preview build is separate from a successful production deployment
and a verified menu interaction in the owner's Telegram chat.
