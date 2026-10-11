# Telegram report menu

In an authorized private chat, send `/start`, `/help` or `/menu` once to display
the persistent button keyboard. It also accompanies subsequent report replies
and images. If Telegram hides the keyboard, use the keyboard icon beside its
message field to reopen it.

| Button | Existing command |
|---|---|
| وضعیت | `/status` |
| دارایی‌ها | `/assets` |
| طلا و سایر فلزات گرانبها | `/gold_and_other_precious_metals` |
| رمزارز | `/crypto` |
| نقدینگی | `/cash` |
| Latest Allocation | `/latest_allocation` |
| راهنما | `/help` |

Slash commands still work, including the `/gold` alias. The old `/allocation` and
`/refresh` commands both invoke Latest Allocation. This operation refreshes
OneDrive quantities, verifies the new snapshot, then fetches market prices. Buttons run through the
same private-chat access checks and quantity freshness checks as commands.
When asked for an EcoCoach price, type the current price in the message field;
other menu selections continue to work while that request is pending.

The image table displays ETH quantities to three decimal places and BTC to four.
Only presentation is rounded; stored quantities and valuation arithmetic retain
full precision. Both 18K gold gram holdings use the live TGJU `geram18` quote.
The precious-metals report excludes طعام and نهال; both remain in the portfolio.

## Regression verification

Run `node --experimental-vm-modules --test tests/*.test.mjs` from the repository
root. The 45 passing tests cover menu routing, access control, stale snapshots,
EcoCoach input, report-image precision and the precious-metal pricing fixes.
A successful preview build is separate from a successful production deployment
and a verified menu interaction in the owner's Telegram chat.
