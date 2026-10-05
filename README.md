# Portfolio Agent Telegram Bot

Telegram webhook service for the Portfolio Agent.

## Architecture

- Vercel hosts the webhook.
- Telegram sends updates to `/api/telegram`.
- Portfolio configuration and asset quantities remain external to this repository.
- `Trading Journal.xlsm` is read-only and is never modified by this application.
- Live market prices are obtained independently from external market-data sources.
- Secrets must be stored as Vercel environment variables, never committed to Git.

## Environment variables

Required:
- `TELEGRAM_BOT_TOKEN`

Recommended:
- `TELEGRAM_WEBHOOK_SECRET`

Future data-source variables will be added when the Microsoft/OneDrive access layer is connected.
