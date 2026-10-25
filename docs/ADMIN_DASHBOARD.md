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

Existing approved users without a delegated admin or financial advisor role are guests automatically;
no ownership/access-state rewrite is needed. Guests receive only the percentage
composition chart. They cannot access quantities, total valuation, notes,
category reports, the image/text report submenu, status diagnostics or admin
controls through buttons, slash commands, aliases or old callbacks. Admins and
the owner retain the full report menu. Guest charts and captions contain no
total or footnotes; no detailed valuation object is returned in guest mode.

Guest charts check EcoCoach's website first. If no verified quote is available,
they use the owner's explicitly approved fixed fallback of **1,030,000 toman per
unit** (2026-10-13). No admin price prompt or second sync is needed for guests;
old guest-price relay buttons are inactive. Owner/admin reports retain the
manual-price prompt if the website has no reliable quote. Guest charts still
require a fresh verified OneDrive snapshot, complete other prices and current
access; they show no total, quantities or notes.

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
  Sensitive report delivery requires an admin or financial advisor role, including between text
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


### Storage diagnosis (2026-10-13)

The authenticated storage canary checks conditional updates using representative
UTF-8 JSON rather than a tiny ASCII record. It compares access-object read and
metadata ETags, reporting only equality, weak/strong flags and byte size. Failure
phase/type is returned without identifiers, ETag values, content or credentials.
The canary never changes real user access or holdings.


**Verified production cause:** the 2026-10-13 probe returned HTTP 503 at
`conditional_update` with `precondition_failed`. The live 1,083-byte access
object's download ETag was weak and differed from its strong storage metadata
ETag. A representative Persian-text canary reproduced the conditional-write
failure without changing access counts. Small ASCII canaries had succeeded.
Access-state and canary version reads now request `Accept-Encoding: identity`
while bypassing the cache. Weak ETags remain rejected; they are never stripped
or replaced by an unconditional overwrite. Regression tests cover promotion,
demotion, weak-tag refusal and concurrent-update rejection.


## Financial advisor role — مشاور مالی (2026-10-14)

Owner/admins can approve new requests as guest, financial advisor or admin and
assign these roles to an existing approved user in **مدیریت نقش‌ها**. The new
`financialAdvisors` list is private, restricted to approved users, excludes the
owner/admin identities and is mutually exclusive with delegated admin rights.
Existing roles stay unchanged; no automatic live permission migration is needed.
Role assignment uses the same strong-ETag conditional update and audit log.
Owner/self role protections, revocation and conflict rejection remain in force.

Advisors receive report buttons for assets, latest allocation (picture/text),
composition chart, precious metals, crypto and Cash Dollar. Start/help/menu and
manual price input support those reports. System/portfolio status, admin panels,
access approval/revocation, role changes, audit and storage diagnostics remain
admin-only and are denied even through typed commands or forged callbacks.
Access requests notify only admins, never advisors.

Full financial reports may show totals. Historical asset comments are restricted
to owners/admins; advisors see only BlackRock's `صندوق خصوصی اکوکوچ` description,
without asterisks for hidden comments. This applies to text, image footers,
chart captions and error replies (owner request, 2026-10-15). Any report prepared
with private notes requires current admin permission at each text/image send,
even if the former admin remains an approved advisor. Advisors use the
normal website-first EcoCoach lookup and manual-price prompt, not the guest
fixed fallback. Reports require fresh verified quantities where applicable,
complete prices, and current report permissions before each text/image send.
Demoting an advisor to guest or revoking access blocks detailed report delivery,
including during a pending request. Guests retain chart-only access with no
total or notes. Authenticated operational health discloses advisor counts only.

## Weekly access, monitoring and command activity (2026-10-17)

Owners and approved delegated admins have no time limit. Guest and financial
advisor access lasts exactly seven 24-hour days from approval, compared against
server time before command execution, menus, callbacks, workflow completion and
each report chunk/image delivery. At the deadline access is inactive even when
no scheduled job has run. Keep expired grants in private state for monitoring
and renewal; retained membership alone must never authorize access. There is no
activation broadcast, countdown, expiry warning or expiry notification to users.
Expired report attempts and stale callbacks are silent. An explicit `/start`
can submit a normal approval request again, without an expiry notice.

**پنل مدیریت → پایش زمان دسترسی** shows each registered user's role, remaining
days/hours/minutes, bold Persian-calendar expiry time in Tehran, and expired
status. Owners/admins show no limit. Non-admin rows offer **1 day**, **3 days**
and **1 week** extensions. Add time to an active deadline; renew an expired
user from the current time. Extensions preserve guest/advisor roles and do not
message the user. Only current admins can extend access; unknown/manually
revoked users and owners/admins cannot be extended. Strong identity ETags reject
concurrent writes, and recent extension callback retries are deduplicated in the
management audit. Pagination and previous-panel cleanup remain in effect.

Promotion makes the admin role unlimited. Demotion from admin to guest/advisor
starts a fresh week; switching guest/advisor roles preserves the existing
deadline. Approval and explicit role-change messages retain their normal text,
without adding any time-limit notice. Manual revocation remains an explicit
admin action with its existing message; automatic expiry sends none.

Private state adds `accessTerms[uid]` (`approved_at`, `expires_at`, `source`) and
`accessPolicy` (`version`, `activated_at`). Explicit invalid terms fail closed.
For legacy grants, recover the newest recorded approval from user metadata or
the bounded audit history. With no recoverable date, use the persisted policy
activation time for a single seven-day period; never reset that fallback on
reads, requests, redeploys or restarts. Owners/admins are exempt.

The authenticated `POST /api/telegram?configure=access-expiry` previews migration
by default. JSON `{"apply":true}` persists missing terms and activation time
with a conditional write, with no Telegram sends. Repeated application preserves
existing deadlines. `GET ?data=access-health` reports aggregate active/expired,
persisted-term and fallback counts, never identities or private comments. Before
activation, legacy grants without recoverable dates fail closed; activate and
verify immediately after deploying this feature. No workbook or snapshot write
is involved. Do not create fake approval history for unknown dates.

Each real, authenticated private-chat Telegram command from a non-admin sends
an activity message to current owners/admins. Persian menu buttons use canonical
command names; valid report-format selections identify image/text/menu choice.
Alerts show escaped user name/username, user ID, requested command, current role
or inactive status, and a bold Persian Tehran timestamp. Commands are requests,
not proof that a report succeeded. Expired/unapproved command attempts are also
included. Never forward free text, EcoCoach prices, command arguments, holdings
or credentials. Owners/admins' own commands create no activity alert. Group,
mismatched-identity and unauthenticated traffic cannot generate alerts.

Alerts run as background work and do not change admin keyboards or delete the
current dashboard. Each recipient is rechecked before delivery. Private
`portfolio/command-activity/{update_id}/{admin_id}.json` receipts use conditional
writes and 30-second send leases to suppress duplicate successful deliveries.
Each send gets up to two bounded attempts; failed receipts can retry on replay.
Alert delivery is best effort when Telegram/storage is unavailable and must not
prevent the user's report. An interrupted send whose acknowledgment was lost
can be retried after its lease; Telegram offers no send-message idempotency key.
Tests use genuine update IDs for activity while older focused fixtures can omit
them; only a real update ID creates an activity receipt.

## Expired membership removal (owner request, 2026-10-25)

This supersedes the earlier retained-expired-grant behavior. Before bot commands,
admin screens/actions and workflow completions, valid expired non-admin grants
are removed conditionally from `approved`, financial-advisor roles, active terms,
pending approvals and user profiles. Owners and delegated admins are exempt.
Strong-ETag conflicts re-read current state so a concurrent extension is preserved.
The authenticated `POST ?maintain=expired-access` performs the same cleanup with
no Telegram sends. An hourly Actions job (minute 7 UTC, minute 37 Tehran) covers
idle periods; exact deadline authorization remains independent of scheduler delays.

Removed users do not appear in approved-user, role or monitoring lists. Old
extension buttons cannot reinstate removed users. They must submit `/start` and
receive a new approval; new approval clears the removal marker and old price
prompt. Minimal private `expiredUsers` timestamps preserve silent rejection of
old commands/callbacks. They are not active grants. Bot API cannot delete the
private chat from the person's Telegram client. No activation/expiry warning is
sent. Manual revocation remains separate and retains its existing notification.
