# Telegram report menu

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
| نقدینگی | `/cash` |
| آخرین تخصیص دارایی | `/latest_allocation` |
| راهنما | `/help` |
| پنل مدیریت (مالک و مدیران منتخب) | `/admin` |

Slash commands still work, including the `/gold` alias. The old `/allocation` and
`/refresh` commands both invoke Latest Allocation. This operation refreshes
OneDrive quantities, verifies the new snapshot, then fetches market prices. Buttons run through the
same private-chat access checks and quantity freshness checks as commands.
When asked for an EcoCoach price, type the current price in the message field;
other menu selections continue to work while that request is pending.

Progress notices and EcoCoach price prompts are temporary. After the next text
reply or report image is confirmed delivered, the bot deletes the old notice.
Failed delivery preserves it; report messages, images and user input remain.
Only bot-created IDs are stored privately. Telegram cannot delete messages older
than 48 hours; temporary deletion errors are retried on a later successful reply.

The image table displays ETH quantities to three decimal places and BTC to four.
Only presentation is rounded; stored quantities and valuation arithmetic retain
full precision. Both 18K gold gram holdings use the live TGJU `geram18` quote.
The precious-metals report excludes طعام and نهال; both remain in the portfolio.

The [admin dashboard](ADMIN_DASHBOARD.md) is visible only to the configured
owner and chosen admins who still have approved portfolio access. The owner
selects them from the approved-user list and can remove their admin roles.

## Regression verification

Run `node --experimental-vm-modules --test tests/*.test.mjs` from the repository
root. The tests cover menu routing, access control, stale snapshots,
EcoCoach input, report-image precision and the precious-metal pricing fixes.
A successful preview build is separate from a successful production deployment
and a verified menu interaction in the owner's Telegram chat.
