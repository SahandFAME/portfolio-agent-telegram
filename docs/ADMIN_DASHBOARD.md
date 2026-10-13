# Owner and admin dashboard

In the owner's private bot chat, send `/start` to refresh the keyboard, then
choose **پنل مدیریت**. `/admin` also opens it. All dashboard text is Persian.

Panel screens, page navigation, confirmation prompts and storage-test results
are temporary. A successfully delivered next reply removes the preceding panel
screen; failed delivery leaves it usable. Clicking an existing bot-owned panel
also retires that screen after replacement, including panels created before this
cleanup feature. Unanswered access-request notifications are excluded from panel
cleanup; clicking their approval/rejection buttons replaces that notification.
Telegram's 48-hour deletion limit still applies to old messages.

Each admin screen includes **بازگشت به منوی اصلی** to exit to the report
dashboard without `/start`. The report keyboard is supplied by a separate,
retained main-menu message. Cleanup deletes the old inline admin screen, not
that keyboard source. Explicit menu returns/reopening keep only the newest
main-menu message, within Telegram's deletion limit, using private message-ID
metadata in `portfolio/main-menu/{chatId}.json`. The menu can be dismissed
normally; Telegram controls behavior on the phone Back button and chat re-entry.

| Control | Function |
|---|---|
| کاربران مجاز | Paginated user list, names/IDs/roles, access revocation with confirmation |
| درخواست‌های دسترسی | Approve as guest/admin, or reject pending requests |
| مدیریت نقش‌ها | Promote an approved guest or demote another admin to guest |
| وضعیت سامانه | Snapshot age/count, Tehran timestamps, configuration and current request status |
| آزمون ذخیره‌سازی | Verify write/readback and stale-write rejection on a separate private canary |
| رویدادهای مدیریت | Last ten access/role changes, actors and Tehran timestamps |

The immutable owner identities remain the existing `TELEGRAM_ADMIN_USER_IDS`
configuration. No new owner ID or credential is required. Dashboard controls
cannot remove these identities; changing ownership requires deployment settings.

As authorized by the owner on 2026-10-13, every current admin may approve a new
request explicitly as **guest** or **admin**, promote an existing approved guest,
or demote another admin to guest. Role changes cannot target the immutable owner
or the actor's own role. Admins can revoke guests; direct revocation of another
admin remains an owner action. Demotion preserves approval but restricts access
to the guest chart. Revoking portfolio
access removes both permissions, clears pending price input and removes the
keyboard. Users receive the result of the access change.

Existing approved users without a delegated admin role are guests automatically;
no ownership/access-state rewrite is needed. Guests receive only the percentage
composition chart. They cannot access quantities, total valuation, notes,
category reports, the image/text report submenu, status diagnostics or admin
controls through buttons, slash commands, aliases or old callbacks. Admins and
the owner retain the full report menu. Guest charts and captions contain no
total or footnotes; no detailed valuation object is returned in guest mode.

If the EcoCoach price requires manual input for a guest chart, admins receive a
private prompt button. An authorized admin selects the matching pending request
and enters the price. The bot starts a second fresh OneDrive sync for that guest
and renders only the redacted chart. The guest never sees the fund quantity,
manual price prompt or notes. Expired, replaced and revoked requests cannot be
resumed; the entered price is scoped to that request, not a reusable quote cache.

Names come from recorded access requests or a read-only Telegram `getChat`
lookup; unavailable names fall back to the numeric Telegram ID. Lists paginate
eight entries at a time. Display names are sent as plain text, not HTML.

## Authorization and persistence

- The dashboard button is generated for each recipient. Ordinary users receive
  the report menu without it. Typing `/admin` or forging callback data grants no
  privileges.
- Callbacks require the actor's own private chat and current permissions. Old
  approval buttons cannot reapprove a revoked user without a new pending request.
- Admin list delivery and portfolio text/image delivery recheck current roles.
  Sensitive report delivery requires an admin role, including between text
  chunks. An image prepared before demotion cannot be delivered as a guest
  image. Guest-safe image delivery is a separate renderer path.
  Revoked users cannot resume queued allocations or receive images after access
  is removed while prices are loading.
- `portfolio/access-control.json` remains private. The existing approved/pending
  fields are preserved; `delegatedAdmins`, `users` and `audit` are added when an
  authorized change is saved. The audit retains the last 100 changes.
- Reads used for changes fail closed. Writes use the Blob ETag (`ifMatch`), or
  create without overwrite if no state exists. A conflicting update is rejected
  rather than silently restoring revoked roles or erasing another change.
  Reopen the panel to act on the current state.
- Blob SDK minimum version is 2.8.1 for conditional-write support. The dashboard
  storage test uses only `portfolio/diagnostics/access-storage.json`; it never
  writes permissions, quantities or the workbook.
- `/users`, `/approve USER_ID` and `/revoke USER_ID` remain available to current
  admins with the same owner protections. The approve command and legacy approve
  buttons open an explicit role choice. Dashboard revocation asks for
  confirmation; the explicit `/revoke` command remains immediate.

## Safe operational verification

`GET /api/telegram?data=access-health` requires the existing portfolio sync
secret. It returns only owner/member/request/admin/audit counts and conditional
update readiness, without identities or credential contents.

`POST /api/telegram?verify=access-storage` uses the same authentication and
returns whether live conditional writes and exact canary readback succeeded.
It deliberately attempts a stale ETag overwrite and requires its rejection.
Neither diagnostic sends Telegram messages or changes any access permission.

The system-status panel reports configuration and cached snapshot freshness;
it does not claim a configured token is unexpired, that all market providers
are healthy, or that a recurring OneDrive replacement is running. Latest
Allocation still performs a fresh workbook read and market fetch per request.

## Regression verification

Run `node --experimental-vm-modules --test tests/*.test.mjs` and
`python -m unittest discover -s tests -p 'test_*.py'` with the documented Python
environment. Admin tests exercise the actual webhook handler with private Blob
and Telegram dependencies mocked, including persistence conflicts and revocation
during price retrieval. Production checks separately verify the deployed commit,
protected snapshot/access metadata, conditional canary and webhook configuration.
A real owner's menu interaction remains separate from these automated checks.
