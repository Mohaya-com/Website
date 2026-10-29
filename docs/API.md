# API reference (`/api/v1`)

All endpoints are served by `packages/server` (mounted by `apps/web/app/api/v1/[...path]/route.ts`).

**Conventions**

- Request and response bodies are JSON. Timestamps are ISO 8601 in UTC.
- **Auth:** web uses the HttpOnly session cookie; mobile sends `Authorization: Bearer <token>` plus `X-Client: mobile`.
- Error format: `{ "error": { "code", "message": "errors.<code>", "fields"?: { "<field>": "<translation key>" }, "details"? } }`. Common statuses: 400 validation, 401 unauthenticated / session expired, 403 forbidden or password change required, 404, 409 conflict / invalid transition / stale version / overlap, 429 rate limited (with `Retry-After`), 503 SMS unavailable.
- State-changing requests must use `Content-Type: application/json`. Cookie-authenticated requests must also come from an allowed `Origin`.
- Lists use `?page=&pageSize=` (max 100) and return `{ items, page, pageSize, total, totalPages }`.

Legend: 🌐 public · 👤 any signed-in member · 🧳 visitor · 🛡 staff (admin + security) · 👑 admin only.

## Public and authentication

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | 🌐 | Liveness and database check |
| GET | `/public/config` | 🌐 | Compound name, time zone, duration limits, SMS/push availability, demo flag |
| GET | `/public/gates/:code` | 🌐 (rate-limited) | Gate name and supported actions for a printed gate QR |
| GET | `/dev/otp-outbox` | 🌐 **development provider only** | Codes "sent" by the dev SMS provider; 404 otherwise |
| POST | `/auth/staff/login` | 🌐 | `{ username, password, client }` → session (cookie for web, token for mobile) |
| POST | `/auth/visitor/request-otp` | 🌐 | `{ documentType, documentNumber, mobile, mobileCountry? }` → identical response for every identity |
| POST | `/auth/visitor/verify-otp` | 🌐 | `{ challengeId, code, client }` → visitor or registrant session |
| GET | `/auth/session` | 🌐 | Current session or `null` |
| POST | `/auth/logout` | 🌐 | Revokes the session |
| POST | `/auth/password` | 🛡 | Change password (allowed while a change is required) |
| PUT | `/me/locale` | 👤 | Persist `ar`/`en` (used for push text) |
| GET | `/setup/status`, POST `/setup/first-admin` | 🌐 | One-time first-administrator setup (needs `SETUP_TOKEN`) |

## Visitor self-service

| Method | Path | Purpose |
|---|---|---|
| POST | `/me/register` | Registrant completes the profile (name, nationality, expiry) |
| GET / PATCH | `/me/profile` | Own masked profile / renew the document expiry date (`expectedVersion`) |
| GET / POST | `/me/visits` | Own visits (paginated) / submit a request (`clientRequestId` for idempotency) |
| GET / PATCH | `/me/visits/:id` | Status / modify (an approved visit is replaced by a new pending one) |
| POST | `/me/visits/:id/cancel` | Cancel before check-in |
| GET | `/me/visits/:id/pass` | QR pass when approved or inside |
| GET | `/villas/options` | Active villa numbers (👤) |

## Staff

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/dashboard/summary` | 🛡 | Pending, approved upcoming, inside, completed today, overdue, expected today |
| GET | `/visitors/lookup?documentNumber=` | 🛡 (audited, rate-limited) | Exact ID / Iqama lookup |
| GET | `/visitors?q=&nationality=` | 👑 | Search by name, ID, mobile or reference (masked) |
| POST | `/visitors` | 🛡 | Create a profile (409 `duplicate_visitor` with `details.visitorId`) |
| GET / PATCH | `/visitors/:id` | 👑 / 🛡 | Full profile / reasoned, audited update (identity fields admin-only) |
| GET | `/visitors/:id/visits`, `/visitors/:id/versions` | 👑 | Visit history / profile change history |
| GET | `/visits` | 👑 | History with `status, villaId, gateId, nationality, from, to, q, overdue, sort` |
| POST | `/visits` | 🛡 | Submit on behalf of `visitorId` |
| GET | `/visits/inside`, `/visits/expected` | 🛡 | Occupancy (with overdue flags) / approved visits for today |
| GET / PATCH | `/visits/:id` | 🛡 | Operational detail / modify |
| GET | `/visits/:id/review` | 👑 | Approval detail: profile, document status, chronological history, stats, blocked reason |
| POST | `/visits/:id/approve` | 👑 | Approve (`expectedVersion`) → window and pass issued |
| POST | `/visits/:id/reject` | 👑 | `{ reason }` (required) |
| POST | `/visits/:id/cancel` | 👑 | Cancel before check-in |
| GET | `/visits/:id/pass` | 🛡 (audited) | Display the pass (e.g. for a visitor without the app) |
| POST | `/scan/verify` | 🛡 | `{ qr \| visitId, gateId, action }` → decision, checks, identity, visit; no state change |
| POST | `/scan/confirm` | 🛡 | Same plus `identityConfirmed` (required for entry) → records the event atomically |
| POST | `/scan/lookup` | 🛡 | `{ query, action }` manual lookup by reference or exact ID |
| GET | `/gate-events` | 🛡 | Entry/exit log (`gateId, type, from, to`) |

Scan result `code` values: `entry_allowed`, `exit_allowed`, `entry_recorded`, `exit_recorded`, `invalid_pass`, `pass_revoked`, `not_approved`, `rejected`, `cancelled`, `expired`, `too_early`, `window_closed`, `document_expired`, `already_checked_in`, `already_completed`, `not_checked_in`, `gate_not_allowed`, `visitor_inside_elsewhere`, `identity_not_confirmed`.

## Administration

| Method | Path | Purpose |
|---|---|---|
| GET / POST / PATCH | `/gates`, `/gates/:id` | List (`?all=true` for admins) / create / update, `regenerateCode` |
| GET / POST / PATCH | `/villas`, `/villas/:id` | Manage villas |
| GET / POST / PATCH | `/users`, `/users/:id` | Staff accounts (no self-deactivation; the last active admin is protected) |
| POST | `/users/:id/reset-password` | Temporary password, shown once |
| GET / PUT | `/settings` | System settings |
| GET | `/audit` | Audit log (`action, entityType, actorUserId, from, to`) |

## Notifications and real time

| Method | Path | Purpose |
|---|---|---|
| GET | `/notifications`, `/notifications/unread-count` | In-app history / badge |
| POST | `/notifications/:id/read`, `/notifications/read-all` | Mark as read |
| POST / DELETE | `/push-tokens` | Register / remove an Expo push token |
| GET | `/events` | Server-Sent Events: `ready`, `change` (`{t:'visit', visitId, visitorId, status}` / `{t:'notification'}` / `{t:'config'}`), `session` |
