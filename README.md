# Portfolio Agent — Telegram Bot

This is the Vercel-hosted Telegram presentation service for the user's 29-asset Portfolio Agent. The source of truth for **23 quantities** is the **read-only** OneDrive `Trading Journal.xlsm`; **six** other asset quantities are manually controlled. The encrypted, private Vercel Blob quantity snapshot is a cache, not the authoritative workbook.

**For Codex and maintainers, start with:**
- [AGENTS.md](AGENTS.md) — mandatory data-integrity and security rules
- [docs/CODEX_HANDOFF.md](docs/CODEX_HANDOFF.md) — historical setup, full asset/table mapping, architecture, sync, deployment, latest verification and outstanding tasks

## Main integration points

- Production: `https://portfolio-agent-telegram.vercel.app/api/telegram`
- Telegram: `@SaRoPortfolioAgentBot`
- Serverless webhook: `api/telegram.js`
- Authenticated 23-asset sync: `POST /api/telegram?sync=portfolio`
- Protected readback: `GET /api/telegram?data=portfolio`
- Private access-managed Telegram commands: `/status`, `/assets`, `/allocation`, `/gold`, `/crypto`, `/cash`, `/refresh`

## Safety

Never commit or print tokens, OAuth credentials, Vercel environment values, or the raw workbook. Only use authorized OneDrive/SharePoint access and live, independent market prices. Do not calculate incomplete portfolio totals or silently replace stale quantities. See AGENTS.md.

## Development and independent operations

Run `npm ci` and `npm test` with Node 24. The Python sync tests require `scripts/requirements-sync.txt`; run `python -m unittest discover -s tests -p 'test_*.py' -v` in an isolated Python environment.

[docs/OPERATIONS.md](docs/OPERATIONS.md) records the current access audit, prepared fixes, Microsoft consent and secure configuration, read-only synchronization/monitoring commands, and the approval gates for migration. The operations workflow starts manual-only; it does not replace the existing ChatGPT automation until access, independent scheduled verification and owner approval are complete.

## Operational status (2026-10-10)

The workbook-to-production **one-time sync and authenticated cache readback** succeeded with all 23 correct asset balances. A ChatGPT scheduled daily sync was created for around 09:00 Tehran, first run scheduled for 2026-10-11; recurring executions and a fresh Telegram /status end-to-end check were not yet verified. The original previously proposed external sender was not located. See the handoff for exact evidence and follow-up actions.
