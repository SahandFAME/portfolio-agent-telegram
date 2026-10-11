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

| Control | Function |
|---|---|
| کاربران مجاز | Paginated user list, names/IDs/roles, access revocation with confirmation |
| درخواست‌های دسترسی | Approve or reject pending requests |
| مدیریت مدیران | Owner-only selection/removal of admin roles from approved users |
| وضعیت سامانه | Snapshot age/count, Tehran timestamps, configuration and current request status |
| آزمون ذخیره‌سازی | Verify write/readback and stale-write rejection on a separate private canary |
| رویدادهای مدیریت | Last ten access/role changes, actors and Tehran timestamps |

The immutable owner identities remain the existing `TELEGRAM_ADMIN_USER_IDS`
configuration. No new owner ID or credential is required. Dashboard controls
cannot remove these identities; changing ownership requires deployment settings.

The owner may choose additional admins only from currently approved users.
Chosen admins can approve/reject requests and revoke ordinary user access. Only
the owner can grant/remove admin roles or revoke a chosen admin's portfolio
access. Chosen admins cannot revoke owners, other admins, or themselves.
Removing an admin role preserves ordinary portfolio access. Revoking portfolio
access removes both permissions, clears pending price input and removes the
keyboard. Users receive the result of the access change.

Names come from recorded access requests or a read-only Telegram `getChat`
lookup; unavailable names fall back to the numeric Telegram ID. Lists paginate
eight entries at a time. Display names are sent as plain text, not HTML.

## Authorization and persistence

- The dashboard button is generated for each recipient. Ordinary users receive
  the report menu without it. Typing `/admin` or forging callback data grants no
  privileges.
- Callbacks require the actor's own private chat and current permissions. Old
  approval buttons cannot reapprove a revoked user without a new pending request.
- Admin list delivery and portfolio text/image delivery recheck current access.
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
  admins with the same owner protections. Dashboard revocation asks for
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
