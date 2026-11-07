# Resume Portfolio Agent without the original chat

This is the recovery entry point if a chat, Codex project or cloud workspace is
lost. GitHub preserves the implementation and documented decisions, not the full
conversation or the original assistant's hidden context. Equivalent operational
continuity requires the repository, private runtime data and authorized access.
A new chat must inspect current evidence rather than assume old access still works.

## Owner's recovery steps

1. Keep ownership/recovery access to GitHub, Vercel, the personal Microsoft
   account holding OneDrive, and the Telegram account that owns the bot in
   BotFather. Save account recovery codes privately.
2. Keep a private copy of this guide and an offline Git repository backup outside
   ChatGPT. A source ZIP is useful, but a full Git clone also preserves history.
   Optional account chat export preserves discussion not transcribed into docs;
   it contains private information and must never be committed to this repository.
3. Keep the published Codex cloud environment if available. In a new project,
   select it and the same repository. If it is unavailable, recreate the settings
   below using protected environment settings and a password manager, not chat.
4. Connect GitHub, select `SahandFAME/portfolio-agent-telegram` on `main`, and paste
   the starter prompt at the end. Restoring the same services is preferable to
   creating another bot, app registration, Vercel project or independent sender.
5. Let the new assistant verify access and report only specific missing grants.
   Access permissions, tokens and tool availability are not transferred by a prompt.

## Read order and current decisions

Read `AGENTS.md`, `docs/CODEX_HANDOFF.md`, this guide, GitHub Issue #1 and the
latest commits/PRs before changing anything. The handoff includes dated historical
sections: newer decisions and current source supersede old command names and
old backlog statements. Read the topic documents as needed:

| Document | What it preserves |
| --- | --- |
| `LATEST_ALLOCATION.md` | Fresh quantities for every asset/report request, all output formats, renderers and note permissions |
| `GOLD_HISTORY.md` | Persian monthly history, source reconstruction, owner decisions, price evidence, estimates and OneDrive export |
| `ADMIN_DASHBOARD.md` | Approval, roles, silent expiry/extensions, command activity and authorization controls |
| `BOT_MENU.md` | Persian menu, commands, presentation, rounding and minimum report value |
| `ECOCOACH_PRICING.md` | Website-first fund quote, manual input and the guest-only fixed fallback |
| `ONEDRIVE_VERIFICATION.md` | Read-only source consent, quantity checks and independent worker verification |

Current requirements to preserve:

- The existing bot, services and working functionality are maintained. Source
  `Trading Journal.xlsm` is read-only. Exactly 23 named table totals control
  workbook quantities; six manual holdings change only on explicit owner instruction.
- Every asset/category/allocation report refreshes and verifies OneDrive quantities
  before current-price retrieval. A failed refresh cannot substitute cached reports.
  Help/navigation and `/status` diagnostic screens are separate.
- History is Persian **monthly**, not weekly. Reconstruct true month-end quantities
  and prices; completed months are protected. On-demand history refreshes the
  current provisional month and separate Excel. Monthly chart labels every month
  and uses readable y-axis tick intervals. Estedad and approved chart style B remain.
- Owner-provided historical prices and temporarily authorized last-known prices
  retain their actual dates and estimated labels. Never use future quotes for a
  past valuation. Monthly history uses the historical $5 cutoff; ordinary reports
  exclude values below 50,000 toman from rows, totals and group percentages.
- Owner/admins have unlimited access; guests/advisors have seven-day grants with
  silent expiry and explicit extensions. Guests get only redacted composition
  percentages. Advisors get financial reports, not administration or Excel history
  downloads. Original comments are owner/admin-only; advisors may see the short
  EcoCoach description. Recheck permissions before each delivery.
- Preserve whole-toman rendering, Persian money punctuation, bold Persian-calendar
  Tehran timestamps, precise underlying arithmetic and all source/unit checks.
- Do not retire any legacy ChatGPT synchronization or replace production services
  without the owner's explicit migration approval. On-demand Actions sync and
  monthly history do not prove a separate daily quantity scheduler exists.

## Access inventory: names and locations only

Service identifiers are in the handoff and source. No credential value belongs
in this guide, a prompt, repository, screenshot or public workflow output.

| Access | Where it lives / recovery |
| --- | --- |
| Repository development and Actions operations | GitHub account/Codex integration; restore repository authorization and verify actual read/write/Actions capabilities |
| Cloud `VERCEL_TOKEN` | Protected Codex environment binding to `api.vercel.com`; Vercel account/project authorization is separate |
| Cloud `TELEGRAM_BOT_TOKEN` | Protected Codex binding to `api.telegram.org`; retain BotFather ownership |
| Cloud `PORTFOLIO_SYNC_SECRET_AGENT` | Protected Codex binding to `portfolio-agent-telegram.vercel.app`; matches existing production/Actions sync credential |
| Cloud `PORTFOLIO_SECRET_WRITER_TOKEN` | Protected Codex binding to `api.github.com`; repository-specific Secrets read/write token used for controlled token persistence, not a general GitHub development token |
| Source `MS_GRAPH_REFRESH_TOKEN` | GitHub Actions secret; read-only Microsoft source consent. Re-consent through the existing workflow if unavailable/revoked |
| Report `MS_GRAPH_EXPORT_REFRESH_TOKEN` | Separate GitHub Actions secret; Microsoft report-write consent, never substitute for the read-only source credential |
| `ONEDRIVE_GOLD_HISTORY_REPORT_ID` | GitHub Actions secret identifying the existing managed report; preserve its identity/conditional-write checks |
| Production runtime settings | Vercel production: bot/webhook/admin IDs, Blob token, sync secret(s), `SETUP_SECRET`, `GITHUB_ACTIONS_TOKEN`; inspect current source for the definitive inventory |

GitHub secret values cannot be read back through the GitHub API. A saved secret
name is not a backup of its value. Reuse existing vault bindings or an owner's
protected credential copy when possible. Rotating OAuth refresh tokens must be
recovered from the current managed state or reauthorized; a stale exported token
is not guaranteed to work. Do not rotate working production credentials merely
because a chat has been replaced.

The last environment inspection reported the four cloud bindings above ready;
this does not prove every service permission works. Earlier Vercel administration
requests had authorization limits. A new session must test the intended operation
and distinguish configured credentials from successful API authorization.

Non-secret cloud variables currently used are `MS_GRAPH_CLIENT_ID`,
`MS_GRAPH_TENANT_ID` (`consumers`), `MS_GRAPH_AUTH_MODE` (`delegated`),
`MS_GRAPH_DRIVE_ID`, `MS_GRAPH_ITEM_ID`, `PORTFOLIO_ENDPOINT` and
`GITHUB_REPOSITORY`. Recover public identifiers from the existing workflow/source.
Do not infer migration approval from a copied variable such as
`PORTFOLIO_MIGRATION_APPROVED`; review the owner's actual authorization.

For restricted cloud networking retain the GitHub, Node and Python dependency
presets plus the required service/provider hosts. Observed custom hosts included
`api.github.com`, `api.vercel.com`, `vercel.com`, `api.telegram.org`,
`graph.microsoft.com`, `login.microsoftonline.com`,
`portfolio-agent-telegram.vercel.app`, `api.coingecko.com`, `cdn.tsetmc.com`,
`gem.tgju.org`, `www.tgju.org` and `www.shakhesban.com`. Also assess exact hosts
used by current source, including `ecocoach.net` and redirects/download endpoints;
this historical list is not proof of complete provider connectivity. Preserve
the managed proxy and CA settings; do not bypass policy or expose tokens.

## Private data is a separate recovery dependency

The existing private Vercel Blob store holds the live snapshot, approval/role/
expiry state, monthly history, owner-supplied prices, historical price evidence,
calendar archives and generated workbook metadata. These are not in GitHub.
Restoring code onto an empty Blob store does not restore the portfolio's history
or approved users. Keep the existing Vercel project and Blob store attached.

The separate report is in OneDrive **اسناد**, `Portfolio-18K-Gold-History.xlsx`.
It is useful as an independent report copy, but does not replace the full private
application state or credentials. Keep the source workbook and any original
private attachments/comments in owner-controlled private storage too.

For protection against loss of Vercel itself, arrange a private encrypted backup
of the complete application Blob namespace and restore metadata, plus protected
service configuration/credential recovery. Retain its encryption key separately
and verify a restore in isolation before relying on it. Do not copy private
records into this public repository or merge stale access records into production.
This guide does **not** establish that such a full encrypted backup/restore test
has been performed; existing report exports alone do not provide that guarantee.
Temporary `/tmp` files, local virtual environments, uncommitted workspace files
and cloud disk snapshots are not the durable recovery source.

## Recreate the toolchain and verify ownership

Use Node 24 and Python 3.12 as in `.github/workflows/bot-regression.yml`.
Install Node dependencies from `package.json` and Python dependencies from
`scripts/requirements-sync.txt` into a virtual environment. No old absolute
workspace path or local helper script is required:

```sh
npm install --package-lock=false --no-audit --no-fund
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements-sync.txt
node --experimental-vm-modules --test tests/*.test.mjs
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

Start with read-only repository/Actions checks, exact production deployment commit,
health and protected snapshot/history readbacks. Verify that the existing private
store and generated report are attached. Do not print their financial contents.
To test Graph without changing production quantities, use `verify-onedrive.yml`;
its source is read-only, but normal OAuth rotation persists the updated token.
Run `latest-allocation-sync.yml` with an empty request ID only when a fresh cache
sync is authorized; it can verify synchronization without Telegram test messages.
`report_type=history` additionally updates current-month history/Excel and triggers
the managed OneDrive report publisher. Do not confuse these writes with a purely
read-only audit. A real private-chat Telegram test is separate evidence and requires
the owner's instruction or participation.

Last established implementation baseline: main
`e5df4e312dda708562bdf8aef6cc7d4fd6a4547b`, PRs #62–#64, 261 Node + 97 Python
tests. The recorded source/history trial is Actions run `42101487836`; verified
OneDrive publication is `42101601853`. These are past checks, not a claim of
current service health. Continue from the latest `main`, not a rollback to this hash.

Future maintainers should update the handoff/recovery guide whenever requirements,
access dependencies, workflows or known blockers change, without storing secrets
or private financial records in public documentation.

## Starter prompt for a new Codex chat

> Resume maintenance of my existing Portfolio Agent. Use repository
> SahandFAME/portfolio-agent-telegram, branch main, and my existing published cloud
> environment if available. Read AGENTS.md, docs/CODEX_HANDOFF.md,
> docs/CODEX_RECOVERY.md, GitHub Issue #1 and the latest relevant PRs before changing
> anything. Treat newer documented owner decisions and current code as authoritative
> over older handoff sections. Audit the current services and authorized access;
> identify only concrete missing permissions. Reuse the existing bot, Vercel project,
> private storage, Microsoft application and OneDrive report. Never write Trading
> Journal, expose credentials or private portfolio records, or rebuild working
> functionality. I authorize routine tested maintenance through PR, CI and deployment
> using the documented safeguards. Do not send live Telegram test messages without
> my instruction. Preserve existing synchronization until I explicitly approve any
> migration. Proceed independently on authorized work and record durable decisions
> in the repository so future sessions can continue without this chat.
