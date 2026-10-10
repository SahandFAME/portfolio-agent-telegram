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
| تخصیص دارایی | `/allocation` |
| به‌روزرسانی | `/refresh` |
| راهنما | `/help` |

Slash commands still work, including the `/gold` alias. Buttons run through the
same private-chat access checks and quantity freshness checks as commands.
When asked for an EcoCoach price, type the current price in the message field;
other menu selections continue to work while that request is pending.

The image table displays ETH quantities to three decimal places and BTC to four.
Only presentation is rounded; stored quantities and valuation arithmetic retain
full precision. Both 18K gold gram holdings use the live TGJU `geram18` quote.
The precious-metals report excludes طعام and نهال; both remain in the portfolio.
