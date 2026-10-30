# نظام إدارة الزوار — Compound Visitor Management System

نظام متكامل لإدارة زوار المجمع السكني: تسجيل الزائر ← طلب الزيارة ← موافقة الإدارة أو رفضها ← تسجيل الدخول بمسح رمز QR عند البوابة ← تسجيل الخروج ← سجل زيارات قابل للبحث. الواجهة عربية أولًا (من اليمين إلى اليسار) مع دعم كامل للإنجليزية.

A complete visitor-management system for a residential compound: an **iOS/Android app** (Expo), a **responsive web app** (Next.js), and **one shared backend** (a Fetch-standard API with all authorization and business rules) on **PostgreSQL**. Arabic is the default language, and RTL is supported throughout.

> **Status.** The project has been built and verified locally. It has **not** been deployed to production, sent real SMS, delivered real push notifications, or been published to the App Store or Google Play. See [Production checklist](#production-checklist).

---

## Contents

1. [Architecture](#architecture)
2. [Project structure](#project-structure)
3. [Quick start (local development)](#quick-start-local-development)
4. [Database configuration](#database-configuration)
5. [Running the web app](#running-the-web-app)
6. [Running the mobile app](#running-the-mobile-app)
7. [Previewing on a physical device](#previewing-on-a-physical-device)
8. [Creating the first administrator](#creating-the-first-administrator)
9. [Roles and permissions](#roles-and-permissions)
10. [Visit lifecycle and approval workflow](#visit-lifecycle-and-approval-workflow)
11. [QR workflows](#qr-workflows)
12. [Visitor verification (OTP) and SMS](#visitor-verification-otp-and-sms)
13. [Notifications and push](#notifications-and-push)
14. [Real-time updates and connectivity](#real-time-updates-and-connectivity)
15. [Security controls](#security-controls)
16. [Building for Android and iOS](#building-for-android-and-ios)
17. [Required external credentials](#required-external-credentials)
18. [Testing and verification](#testing-and-verification)
19. [Production checklist](#production-checklist)
20. [Assumptions and decisions](#assumptions-and-decisions)

Additional documents: [docs/API.md](docs/API.md) (endpoint reference) and [docs/PRIVACY-AND-SECURITY.md](docs/PRIVACY-AND-SECURITY.md) (privacy notice, data handling, retention).

---

## Architecture

```
┌──────────────────────┐   HTTPS + bearer token    ┌─────────────────────────────────────────────┐
│ apps/mobile (Expo)   │ ────────────────────────▶ │ apps/web (Next.js 16, Node runtime)          │
│ iOS / Android        │   SSE /api/v1/events      │  • /api/v1/* → @vms/server handleApiRequest  │
└──────────────────────┘                           │  • Web UI (visitor portal + staff console)   │
┌──────────────────────┐   HTTPS + HttpOnly cookie │  • instrumentation: maintenance sweeper      │
│ Browser (web UI)     │ ────────────────────────▶ └──────────────────────┬──────────────────────┘
└──────────────────────┘                                                  │ Drizzle ORM (pg)
                                                                          ▼
                       @vms/shared (types, Zod schemas, rules, i18n) ◀──▶ PostgreSQL 16
                       used by mobile, web and server                     (constraints, triggers,
                                                                           LISTEN/NOTIFY)
```

- **One backend, one set of records.** Mobile and web call the same `/api/v1` API, served by the Next.js process. The API in `packages/server` is plain Fetch-standard (`Request → Response`), so it can be mounted in any other runtime later without changes.
- **Business rules live on the server.** Every approval, check-in and check-out runs in a transaction with the visit row locked (`SELECT … FOR UPDATE`). The database enforces the key invariants a second time through constraints (see [Database configuration](#database-configuration)).
- **Shared code.** `@vms/shared` contains the Zod schemas, visit state machine, normalization (Arabic digits, ID numbers, phone numbers), time-zone and Hijri helpers, the permission matrix, and all Arabic and English text. Web, mobile and server import it.
- **Real time.** The server publishes change notices with `pg_notify` inside the transaction, so they are delivered only after commit. Each server process keeps one `LISTEN` connection and fans out Server-Sent Events to clients. Clients then refetch through authorized endpoints; event payloads contain identifiers only.

## Project structure

```
.
├── apps/
│   ├── web/                 Next.js 16 app: API mount, web UI, proxy.ts (CSP), instrumentation.ts
│   │   ├── app/api/v1/[...path]/route.ts   ← mounts the shared API
│   │   ├── app/staff/…      Staff console (admin + security), sidebar layout
│   │   ├── app/visitor/…    Visitor portal (OTP verification, requests, pass)
│   │   ├── app/g/[code]     Gate QR landing page        app/p   Pass link landing page
│   │   └── components/, lib/
│   └── mobile/              Expo SDK 58 (React Native 0.88) app, Expo Router in src/app
│       ├── src/app/(visitor)  Tabs: الرئيسية · طلب زيارة · زياراتي · حسابي
│       ├── src/app/(security) Tabs: الرئيسية · مسح QR · الموجودون داخل المجمع · السجل
│       ├── src/app/(admin)    Tabs: لوحة التحكم · طلبات الموافقة · الزوار · المزيد
│       ├── src/app/staff/…    Pushed staff screens (review, register, scan, management…)
│       └── app.config.ts, eas.json
├── packages/
│   ├── shared/              @vms/shared — schemas, rules, i18n (ar/en), countries, unit tests
│   ├── db/                  @vms/db — Drizzle schema, SQL migrations, client, migrator
│   └── server/              @vms/server — API router, auth, services, providers, scripts, tests
├── e2e/                     Playwright smoke and responsive checks (optional)
├── docs/                    API reference, privacy and security notes
├── docker-compose.yml       Local PostgreSQL 16
└── .env.example             All server configuration (copy to .env)
```

Stack: TypeScript 6, pnpm workspaces (hoisted `node_modules` for React Native), Next.js 16.4, React 19.3, Expo SDK 58 / React Native 0.88, Expo Router, TanStack Query, Tailwind CSS 4, Drizzle ORM + node-postgres, Zod 4, Vitest.

## Quick start (local development)

Prerequisites: **Node.js ≥ 22**, **pnpm 10** (`corepack enable`), **PostgreSQL 16** (or Docker).

```bash
pnpm install
cp .env.example .env                 # review the values; dev defaults work as-is
docker compose up -d postgres        # or use an existing PostgreSQL 16 (see below)
pnpm db:migrate                      # create the schema
pnpm db:seed                         # optional: fictional demo data (development only)
pnpm dev:web                         # http://localhost:3000
```

The seed prints demo accounts (development only; the seed refuses to run in production):

| Role | Username | Password |
|---|---|---|
| Administrator | `admin` (Arabic UI), `admin2` (English UI) | `Admin-demo-2026!` (or `SEED_ADMIN_PASSWORD`) |
| Gate security | `guard1`, `guard2` | `Guard-demo-2026!` (or `SEED_SECURITY_PASSWORD`) |

Demo visitors sign in with their ID number plus mobile number, e.g. `1000468221` + `0501234501`. The one-time code is shown at **http://localhost:3000/dev/otp** (development only). When demo data is loaded, every screen shows a purple "بيئة تجريبية" banner.

Reset everything (development only): `pnpm db:seed --reset`.

## Database configuration

- `DATABASE_URL` (in `.env`) points at the application database. `TEST_DATABASE_URL` points at a **separate** database that the test suite drops and recreates.
- The `vms` role needs to own its databases. The migrations create the trusted extensions `pg_trgm` (name search) and `btree_gist` (overlap constraint); on managed PostgreSQL (RDS, Cloud SQL, Azure, Supabase, Neon) the database owner can create them.
- Using Docker: `docker compose up -d postgres` creates `vms` and `vms_test` with the extensions already installed (`packages/db/docker-init.sql`).
- Using an existing server:

  ```sql
  CREATE ROLE vms WITH LOGIN PASSWORD 'change-me';
  CREATE DATABASE vms OWNER vms;
  CREATE DATABASE vms_test OWNER vms;
  ```

- Migrations: `pnpm db:migrate` applies the SQL in `packages/db/migrations` (tracked in `drizzle.__drizzle_migrations`). After changing `packages/db/src/schema.ts`, run `pnpm db:generate` to create a new migration and review the SQL before committing it.

Constraints and triggers that protect the data even if application code were bypassed:

| Rule | Mechanism |
|---|---|
| One profile per identity number | `UNIQUE (visitors.document_number)` + format and prefix `CHECK`s |
| No overlapping open visits per visitor | `EXCLUDE USING gist (visitor_id =, tstzrange(entry, exit) &&) WHERE status IN (pending, approved, checked_in)` |
| One "inside" visit per visitor | partial `UNIQUE (visitor_id) WHERE status = 'checked_in'` |
| One entry and one exit event per visit | `UNIQUE (gate_events.visit_id, type)` |
| One active QR pass per visit | partial `UNIQUE (visit_passes.visit_id) WHERE status = 'active'` |
| Expected exit = entry + duration, rejection needs a reason, approved visits have a window… | `CHECK` constraints on `visits` |
| Audit log, decisions, gate events and profile versions are immutable | `BEFORE UPDATE/DELETE` triggers (audit log also blocks `TRUNCATE`) |
| Idempotent submissions | `UNIQUE (visits.client_request_id)` |

Tables: `users`, `sessions`, `otp_challenges`, `visitors`, `visitor_profile_versions`, `villas`, `gates`, `visits`, `visit_decisions`, `visit_passes`, `gate_events`, `notifications`, `push_tokens`, `audit_logs`, `settings`, `rate_limits`.

**History is preserved.** Each profile change writes a new row to `visitor_profile_versions`. Each visit references the version that was current when it was submitted, and each decision references the version the administrator saw.

## Running the web app

```bash
pnpm dev:web            # development (Turbopack) on http://localhost:3000
pnpm build:web          # production build
pnpm start:web          # serve the production build (requires production configuration, see below)
```

- `/` lets the user choose visitor or staff. `/login` is staff sign-in. `/visitor` is visitor verification. `/staff` is the staff console. `/privacy` is the privacy notice.
- The Next.js process also runs the **maintenance sweeper** (`instrumentation.ts`) every `MAINTENANCE_INTERVAL_SECONDS`. To run it from an external scheduler instead, set `VMS_DISABLE_MAINTENANCE=true` and call `pnpm maintenance` from cron.
- Language: the switcher in the header sets a cookie and persists the preference. `<html dir>` switches between `rtl` and `ltr`.

## Running the mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env   # set EXPO_PUBLIC_API_URL
pnpm dev:mobile                                 # Expo dev server (QR code in the terminal)
```

- `EXPO_PUBLIC_API_URL` must be reachable **from the phone**. Use your computer's LAN address, e.g. `http://192.168.1.20:3000`, never `localhost`.
- Arabic is the default. Switching language calls `I18nManager.forceRTL` and reloads the app so native navigation, gestures and layout flip correctly.
- Session tokens are stored only in the platform keychain/keystore (`expo-secure-store`). Signing out deletes the token, the cached data and any unfinished drafts.

## Previewing on a physical device

1. Put the phone and your computer on the same network and start the web app (`pnpm dev:web`).
2. In `apps/mobile/.env`, set `EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3000`.
3. Run `pnpm dev:mobile` and scan the QR code shown in the terminal:
   - **Android:** use the **Expo Go** app (it must support SDK 58).
   - **iOS:** use the Camera app, which opens Expo Go.
4. If your network blocks LAN traffic, run `npx expo start --tunnel` in `apps/mobile`. The API URL must still reach your computer, for example through a tunnel such as `ngrok http 3000`.

What works in Expo Go and what needs a development build:

| Feature | Expo Go | Development build (`eas build --profile development`) |
|---|---|---|
| All screens, camera QR scanning, RTL, SecureStore | ✅ | ✅ |
| Remote push notifications | ❌ on Android (Expo Go has not supported remote push since SDK 53) | ✅ (needs `EAS_PROJECT_ID`) |
| Universal links / app links (`https://…/g/…`) | ❌ | ✅ (needs `APP_LINK_HOST`) |

## Creating the first administrator

Use **one** of the following options:

**A. Command line (recommended)**

```bash
pnpm admin:create -- --username admin --name "اسم المدير"
```

The command prompts for the password twice (hidden input, at least 10 characters with letters and digits). In a non-interactive shell it instead generates a strong temporary password, prints it once, and requires the administrator to change it at first sign-in.

**B. One-time web setup** (for hosts without shell access)

1. Set `SETUP_TOKEN` to a random value of at least 32 characters and restart the server.
2. Open `/setup` and enter the token, a username, a full name and a password.
3. The page disables itself as soon as an administrator exists. Remove `SETUP_TOKEN` afterwards.

Administrators then create other staff accounts under **الموظفون / Staff**. New accounts get a temporary password that is shown once and must be changed at first sign-in.

## Roles and permissions

Every action is checked on the server (`packages/shared/src/permissions.ts` + `packages/server/src/http/routes/*`). Clients use the same matrix only to decide what to show.

| Capability | Administrator | Gate security | Visitor |
|---|:-:|:-:|:-:|
| Approve / reject requests (rejection needs a reason) | ✅ | ❌ | ❌ |
| View the full approval detail with prior history | ✅ | ❌ | ❌ |
| Register a visitor / submit a request on someone's behalf | ✅ | ✅ | — |
| Look up a visitor by **exact** ID / Iqama number (audited) | ✅ | ✅ | ❌ |
| Search visitors by name, mobile or reference; browse visit history | ✅ | ❌ | ❌ |
| Update expiry date, nationality or mobile (reason required, audited) | ✅ | ✅ | expiry date only (own profile) |
| Change name or document type/number | ✅ | ❌ | ❌ |
| Scan passes and record entry/exit; see who is inside; gate log | ✅ | ✅ | ❌ |
| Cancel any visit | ✅ | ❌ | own visits, before check-in |
| Manage gates, villas, staff accounts, settings | ✅ | ❌ | ❌ |
| Read the audit log | ✅ | ❌ | ❌ |
| See own requests, status, QR pass and history | — | — | ✅ |

Security staff cannot manage accounts, cannot approve requests, and cannot silently change identity data: every change requires a reason and creates a profile version plus an audit record. Identity numbers are masked in lists (`1•••••5678`). Full numbers appear only where an authorized role needs them, such as gate verification, approval review, the exact lookup and the administrator's visitor profile.

## Visit lifecycle and approval workflow

```
pending ──approve──▶ approved ──check-in──▶ checked_in ──check-out──▶ completed
   │                    │  │
   ├─reject──▶ rejected  │  └─window closed──▶ expired
   └─cancel──▶ cancelled ◀─cancel
```

Only these transitions are possible (`packages/shared/src/state-machine.ts`). Each one is applied atomically on the server.

- **Submission.** The visitor (or staff on their behalf) chooses villa, reason ("Other" requires details), entry date and time in compound time, and duration. Expected exit is calculated automatically. A review screen comes before submission. The request is checked for: entry not in the past, entry within the booking horizon, duration within limits, identity valid on the visit date, and no overlapping open visit. Each submission carries a `clientRequestId`, so retries never create duplicates.
- **Approval.** The administrator sees the visitor's full profile, document status (expired / invalid on the visit date / expiring soon), the request, and every previous visit in chronological order, including outcomes, actual entry and exit times, rejection reasons and overstay flags. Approval is blocked when the document is expired or the entry window has already passed. Approval sets the **entry window** (from `entryWindowEarlyMinutes` before to `entryWindowLateMinutes` after the requested time, never later than the expected exit) and issues a QR pass. **Approval never records entry.**
- **Changes after approval.** Changing the villa, reason or timing of an approved visit cancels it, invalidates its pass, and creates a new pending request that needs a fresh approval. Pending requests are updated in place.
- **Stale requests.** A pending request whose entry window passes without a decision is cancelled by the system (it is never left actionable). An approved visit that never checks in **expires** when its window closes, and its pass is revoked.
- **Overdue.** A checked-in visitor past the expected exit (plus `overdueGraceMinutes`) is flagged **overdue** and administrators and security are notified. The visitor **stays "inside" until staff explicitly record the exit.** Exit is allowed even if the window or the document has since expired.
- **Time zone.** Timestamps are stored in UTC. Wall-clock times are entered and displayed in the compound time zone (`Asia/Riyadh` by default, configurable in settings).

Configurable settings (administrator → System settings): default and maximum duration, entry-window early/late minutes, booking horizon, overdue grace, ID check-digit validation, and visitor self-registration.

## QR workflows

**A. Gate QR links (printed posters).** Each gate has a public code. Posters encode `https://<host>/g/<CODE>?a=entry` or `…?a=exit` and contain no personal data; they never authorize anything by themselves. Print them from **البوابات / Gates → طباعة الرموز**. Opening the link:

- **Staff** go straight to the scanner, preset to that gate and action.
- **Visitors at the entry poster** start the visit-request flow, after OTP verification if they are not signed in.
- **Visitors at the exit poster** are shown their pass and told that staff must confirm the exit.

Regenerating a gate code retires old posters.

**B. Individual visit passes.** On approval the server creates a pass whose token is `HMAC-SHA256(PASS_TOKEN_SECRET, passId|nonce)`: 256 bits, unguessable, containing no personal data. Only `SHA-256(token)` is stored. The QR encodes `https://<host>/p#<token>`; because the token is in the URL **fragment**, it never reaches server logs. Cancelling a visit, expiring it, or replacing its approval revokes the pass, and check-out consumes it, so it cannot be reused.

At the gate (mobile or web):

1. Staff sign in and choose the gate and **دخول/خروج**. Scanning a gate poster QR selects both automatically.
2. Scan the pass with the camera (Arabic permission explanation, denied-permission handling, flashlight). Repeated camera reads of the same code are ignored. If scanning fails, use the authorized **manual lookup** by request reference or exact ID number.
3. The server verifies approval, window, document validity, pass status, gate capability and visit state, then returns the visitor's identity details for **visual comparison**.
4. Staff tick «قمت بمطابقة الهوية الأصلية» and press **تأكيد الدخول** (or **تأكيد الخروج**).
5. The server re-checks everything with the visit row locked, records the event (time, gate, staff member), and returns the result. A duplicate or concurrent scan returns «تم تسجيل دخول هذا الزائر مسبقًا» and records nothing.

Clear messages cover every outcome: pending, rejected, cancelled, expired, too early, window closed, document expired, already inside, already used, no active check-in, wrong gate, and invalid code. Nothing is authorized offline or from cached data.

## Arrival registration (no verification code)

When no SMS/WhatsApp provider is used, visitors register themselves at arrival at `/arrive` (linked from the visitor entry page and from gate QR landings):

- **ID photo reading:** an optional photo of the ID/Iqama is downscaled in the browser and read on the server with Tesseract (`tesseract.js` with the bundled English model; no third-party service). The identity number (accepted only with a valid check digit), English name, nationality and expiry date (Gregorian or Hijri) pre-fill the form. Every field stays editable, and manual entry works without a photo.
- **Administrator verification:** requests appear under **Arrivals** (`arrivals.review`, administrators). The ID photo is shown beside the editable entries, alongside any existing profile with the same number. Approval creates the profile, or updates it with a versioned and audited change, then creates and approves the visit and issues the pass. Rejection records a reason that the visitor sees.
- **Privacy:**
  - The submitter only follows their own request through a random status token, stored hashed and kept in the URL fragment or local storage. A request for someone else's identity number never reveals that profile.
  - Photos are stored in PostgreSQL, served only to administrators with `no-store`, and deleted 30 days after the decision.
  - Unreviewed requests close after 24 hours.
  - Submissions and scans are rate-limited per IP.
- Toggle: *Settings → Allow registration at arrival without a code*. Arabic guide: [deploy/ARRIVAL.ar.md](deploy/ARRIVAL.ar.md).
- *OCR is verified on synthetic card images (unit tests, a browser run, and inside the Docker image under a 512 MB limit). It has not been verified on photos of real cards, so accuracy will vary with photo quality.*

## Visitor verification (OTP) and SMS

- The visitor enters document type, ID/Iqama number and mobile number (Arabic or Western digits; `05…`, `5…`, `+9665…` or international numbers). The server **always returns the same response**:
  - **Registered, and the mobile matches:** a code is sent to the registered mobile.
  - **Not registered:** a code is sent to the entered mobile, followed by the registration form.
  - **Registered with a different mobile:** **nothing is sent**, and verification can never succeed. The screen says to contact gate security. A public user can **never** replace the registered mobile; staff update it after checking the original ID, and the change is reasoned, audited, and ends the visitor's existing sessions.
- Codes are 6 digits, valid for 5 minutes, limited to 5 attempts, single use, and stored only as an HMAC. Requests are rate-limited per IP, per ID number and per mobile number, with a 60-second resend cool-down. Stored information is shown only after verification.
- **SMS providers** (`SMS_PROVIDER`):
  - `dev`: **development only.** No SMS is sent. Codes are printed in the server log and shown at `/dev/otp`, and the UI says so explicitly. The server refuses to start with `dev` when `NODE_ENV=production`, and both the page and the endpoint return 404 in production.
  - `twilio`: Twilio Programmable Messaging. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID`. *This integration is written against Twilio's documented REST API but has not been tested with live credentials.*
  - `whatsapp`: WhatsApp Cloud API (Meta) with an authentication template (copy-code button). Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and optionally `WHATSAPP_TEMPLATE_NAME` (default `otp_code`), `WHATSAPP_TEMPLATE_LANGUAGE` (default `ar`) and `WHATSAPP_API_VERSION` (default `v25.0`).
  - `disabled`: visitor self-service sign-in is unavailable and the UI directs visitors to gate security, unless an administrator connects WhatsApp in the settings (below). Staff-assisted registration still works.
- **WhatsApp from the admin settings** (Settings → WhatsApp), used only while `SMS_PROVIDER` is `disabled`/unset. The administrator pastes the Phone number ID, WhatsApp Business Account ID and access token. The server checks them against the Graph API, creates the authentication template if it is missing, can send a test code, and enables sending only once Meta has approved the template. The token is stored encrypted (AES-256-GCM, key derived from `OTP_SECRET`) and is never returned; changing `OTP_SECRET` means pasting the token again. The last delivery failure is shown on the page with phone numbers removed. *Tested against a simulated Graph API, plus a live call that confirmed Meta's invalid-token error is handled; not tested with a real WhatsApp Business account.* Step-by-step guide in Arabic: [deploy/WHATSAPP.ar.md](deploy/WHATSAPP.ar.md).
  - Other gateways (for example local Saudi providers) can be added by implementing `SmsProvider` in `packages/server/src/providers/sms.ts`.

## Notifications and push

Notifications are stored in the database (persistent history, unread badge) and delivered in real time:

- **Administrators** are notified when a request is submitted.
- **Visitors** are notified on approval, rejection, cancellation, automatic cancellation, expiry, and check-in/check-out.
- **Administrators and security** are notified when a visitor is overdue.

Notification text is built from a type plus non-identifying parameters (request reference, villa number), so **push previews never include names or ID numbers**.

**Push (optional):** set `PUSH_PROVIDER=expo` on the server, and build the app with `EAS_PROJECT_ID` (`eas init` creates the project). The app asks for permission after sign-in and registers its Expo push token. `EXPO_ACCESS_TOKEN` is needed only when "Enhanced push security" is enabled for the Expo project. Without these settings, in-app notifications keep working and the app shows that push is not configured. Push delivery has **not** been tested end to end in this environment.

## Real-time updates and connectivity

- Server-Sent Events at `/api/v1/events` (the web uses a cookie; mobile uses `react-native-sse` with a bearer token). A live indicator shows «تحديث مباشر», reconnecting, periodic refresh, or offline.
- Fallback refresh: queries refetch every 30 s, on window focus or app foreground, and on reconnect.
- Offline: a banner appears, forms keep their input, and actions that change state are disabled with «لا يمكن اعتماد الدخول أو الخروج دون اتصال». Unfinished visit-request drafts (no identity data) persist in `sessionStorage` (web) or AsyncStorage (mobile) and are cleared on submit and at sign-out. Identity data entered by staff is kept in memory only.

## Security controls

Summary (details in [docs/PRIVACY-AND-SECURITY.md](docs/PRIVACY-AND-SECURITY.md)):

- **Sessions.** Opaque random tokens; only SHA-256 hashes are stored. Web uses an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefix and `Secure` over HTTPS). Mobile uses SecureStore. Staff sessions end after 12 h idle or 7 days at most; visitor sessions after 30 days. Logout, password change, deactivation and role change revoke sessions.
- **CSRF.** State-changing requests must be JSON. Cookie-authenticated requests must come from an allowed `Origin` (`APP_ORIGIN` and `ADDITIONAL_ORIGINS`).
- **Passwords.** scrypt (N=2¹⁵). Unknown usernames are timing-equalized. Accounts lock for 15 minutes after 5 failures. Temporary passwords must be changed at first sign-in.
- **Rate limiting** (PostgreSQL-backed, so it works across instances) on login, OTP request and verify, lookups, scans, setup and public gate lookups.
- **Validation.** Zod on the server for every input. All queries are parameterized (Drizzle).
- **Headers.** Nonce-based CSP via `proxy.ts`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, and HSTS in production.
- **No personal data** in URLs, QR payloads, logs, error messages or push previews. Database errors are mapped to generic codes, because PostgreSQL error details can contain row values.
- **Append-only audit log** of sign-ins, lookups, profile changes (with masked values and reasons), submissions, decisions, scans, management changes and settings. Visible to administrators only.
- **Secrets** come from environment variables. Production refuses insecure configuration: missing or short secrets, the dev SMS provider, or a non-HTTPS origin.

## Building for Android and iOS

The app is configured for [EAS Build](https://docs.expo.dev/build/introduction/) (`apps/mobile/eas.json`):

```bash
npm i -g eas-cli
cd apps/mobile
eas login
eas init                                   # creates the Expo project; put the id in EAS_PROJECT_ID
# set IOS_BUNDLE_ID / ANDROID_PACKAGE / APP_LINK_HOST and the production EXPO_PUBLIC_API_URL
eas build --profile development --platform android   # dev client (push + app links)
eas build --profile preview --platform android       # installable APK for testers
eas build --profile production --platform all        # store builds (AAB / IPA)
eas submit --profile production --platform all       # upload to Google Play / App Store Connect
```

- **Android:** EAS can manage the upload keystore. For push via FCM, add the Firebase server credentials in the Expo project (`eas credentials`).
- **iOS:** you need an Apple Developer account. EAS manages certificates and provisioning profiles, and the APNs key for push.
- **Universal links / app links:** set `APP_LINK_HOST`. Then on the web server set `IOS_APP_IDS=TEAMID.<bundle id>`, plus `ANDROID_PACKAGE` and `ANDROID_SHA256_CERT_FINGERPRINTS`. The web app serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`; without them, links open the web fallback.
- Local verification of the JavaScript bundles (no native toolchain needed): `pnpm --filter @vms/mobile export:android` / `export:ios`.

## Required external credentials

| Credential | Needed for | Where |
|---|---|---|
| PostgreSQL 16 connection | Everything | `DATABASE_URL` |
| `PASS_TOKEN_SECRET`, `OTP_SECRET` (≥ 32 random chars each, different) | QR passes, OTP hashing, rate-limit keys | Server env |
| HTTPS domain + TLS certificate | Production web app, secure cookies, universal links | Hosting / reverse proxy |
| SMS gateway account (e.g. Twilio) | Visitor OTP | `SMS_PROVIDER`, `TWILIO_*` |
| Expo account + EAS project | Mobile builds, push | `EAS_PROJECT_ID` (mobile), `PUSH_PROVIDER=expo` (server) |
| Apple Developer Program | iOS builds, push (APNs), App Store | EAS credentials |
| Google Play Console + Firebase (FCM) | Android store release, push | EAS credentials |

## Testing and verification

```bash
pnpm typecheck          # all 5 packages (TypeScript strict)
pnpm test               # shared unit tests + backend business-rule tests (needs TEST_DATABASE_URL)
pnpm build:web          # Next.js production build
pnpm --filter @vms/mobile export:android   # Metro/Hermes bundle for Android
pnpm --filter @vms/mobile export:ios       # Metro/Hermes bundle for iOS
```

The backend tests (`packages/server/src/test`) run the real API router against PostgreSQL and cover:

- Approval is required for entry, and approval alone records no entry. Entry needs explicit confirmation including the identity check, inside the window, at a gate that supports it.
- Security staff, visitors and anonymous callers cannot approve or reject. Rejection needs a reason. Security cannot read the audit log, manage users or settings, or search visitors. CSRF and form-post requests are refused.
- Public verification never exposes another visitor. Responses are identical for registered, mismatched and unregistered identities. No code is ever sent to a mismatched number. OTPs are single use and lock after 5 attempts, with rate limits. Visitors cannot read, cancel or obtain passes for other visitors' visits.
- Cancelled and expired passes cannot admit. Expired documents block submission, approval and check-in. Modifying an approved visit invalidates the old pass. Forged QR values are rejected. Stale pending requests are not actionable.
- Eight concurrent entry confirmations produce exactly one event, and concurrent exits likewise. Duplicate submissions create one request, and concurrent overlapping requests create one visit.
- Exit requires an active check-in. A completed pass cannot be reused.
- Overdue visitors are flagged, staff are notified with no identity data in the payload, the visitor remains inside for days, and staff can still record the exit later.
- Returning visitors are found by ID typed in Arabic-Indic digits and are never duplicated. New visits link to the same profile. The administrator review shows the prior history. Earlier visits keep their original profile version.

Optional browser checks (`e2e/`, require Playwright with Chromium and seeded data):

- `node e2e/web-smoke.cjs`: staff and visitor flows on the web, with screenshots.
- `node e2e/responsive-check.cjs`: no horizontal overflow at 375 px, Arabic and English.
- `node e2e/mobile-web-smoke.cjs`: the Expo app rendered with react-native-web at phone size.

## Deployment (Docker, single server)

`deploy/` contains a ready stack: PostgreSQL 16, the web app/API image (`apps/web/Dockerfile`), Caddy with automatic HTTPS, and daily `pg_dump` backups. Migrations run on start.

```bash
cd deploy && cp .env.example .env   # set DOMAIN, ACME_EMAIL, POSTGRES_PASSWORD and the secrets
docker compose up -d --build
docker compose exec web docker-entrypoint.sh create-admin --username admin --name "Admin"
```

The full step-by-step guide in Arabic is [deploy/README.ar.md](deploy/README.ar.md). Without a server, use the Render Blueprint in `render.yaml` ([deploy/RENDER.ar.md](deploy/RENDER.ar.md)).

## Production checklist

- [ ] PostgreSQL 16 with backups and point-in-time recovery; `pnpm db:migrate` in the deploy pipeline.
- [ ] `NODE_ENV=production`, `APP_ORIGIN=https://…`, new `PASS_TOKEN_SECRET` and `OTP_SECRET`, `TRUST_PROXY=true` behind a reverse proxy that **overwrites** `X-Forwarded-For`.
- [ ] Run as a long-lived Node process (`pnpm build:web && pnpm start:web`), or containerize `apps/web`. SSE and the maintenance loop need a persistent process; on serverless hosts, run `pnpm maintenance` from cron and expect SSE to fall back to polling.
- [ ] Configure and test a real SMS provider (`SMS_PROVIDER=twilio` or a custom provider), including Arabic message delivery and sender registration rules in Saudi Arabia.
- [ ] Create the first administrator; remove `SETUP_TOKEN`; do **not** run the demo seed.
- [ ] Configure the compound name, time zone, durations and windows in **System settings**; add real villas and gates; print the gate posters.
- [ ] EAS project, store listings, privacy labels / data-safety forms, push credentials, universal links.
- [ ] Decide and implement a data-retention schedule (see docs) and review it with your legal and privacy advisers. This project does not claim compliance with any specific regulation, including the Saudi PDPL.
- [ ] Monitoring and alerting (process health, `/api/v1/health`, DB), log retention, and penetration testing.

## Assumptions and decisions

- **Identity numbers.** National IDs are 10 digits starting with `1`; Iqama numbers are 10 digits starting with `2`. Both are validated with the Luhn check digit, which administrators can turn off in settings. They are stored as strings of Western digits. Search and validation accept Arabic-Indic digits.
- **Expiry dates.** The user picks the calendar explicitly (ميلادي or هجري أم القرى). Values are stored as a Gregorian `DATE` together with the original input and calendar. The server recomputes Hijri conversion using ICU's Umm al-Qura calendar. A document is valid through its expiry date and is checked against the visit date (compound time zone).
- **One open visit at a time per time range.** A visitor may hold several future requests as long as their time ranges do not overlap, and may be inside on only one visit at a time.
- **Entry window default:** 60 minutes before to 120 minutes after the requested entry, capped at the expected exit. Default duration is 2 h, maximum 12 h, booking horizon 30 days, overdue grace 15 min. All are configurable.
- **Administrators can also scan** (a superset of security permissions). Both roles can register visitors and submit requests on their behalf. Every request, including one submitted by an administrator, still needs an explicit approval.
- **Visitor self-service edits** are limited to renewing the document expiry date. Mobile number changes are staff-assisted only.
- **Staff sign in with a username and password.** Visitors sign in with OTP only; they have no password.
- The visitor-facing web portal provides the same functions as the mobile visitor tabs, so visitors without the app can use a browser.
- Development seed data is fictional. A demo-data flag drives the visible banner.
