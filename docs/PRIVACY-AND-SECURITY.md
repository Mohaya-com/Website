# Privacy and security notes

> This document describes how the software handles personal data and the controls it implements. It is **not** legal advice and does **not** assert compliance with any regulation (for example the Saudi Personal Data Protection Law). The compound operator remains responsible for its own legal review, privacy notice, retention policy and registrations.

## Privacy notice (shown in the apps at `/privacy`)

**إشعار الخصوصية** — نجمع الحد الأدنى من البيانات اللازمة لإدارة دخول الزوار إلى المجمع السكني وضمان سلامة السكان: الاسم الكامل، ونوع الهوية ورقمها وتاريخ انتهائها، والجنسية، ورقم الجوال، وتفاصيل الزيارة (الفيلا، والسبب، والمواعيد، وأوقات الدخول والخروج). تُستخدم هذه البيانات للتحقق من هوية الزائر عند البوابة، واعتماد الزيارات من إدارة المجمع، ومنع الدخول غير المصرح به، والاحتفاظ بسجل أمني للحركة. لا يطّلع عليها إلا إدارة المجمع وأمن البوابة المصرح لهم وفق صلاحيات محددة، ولا يحتوي رمز التصريح على بيانات شخصية. نستخدم رقم جوالك لإرسال رمز تحقق لمرة واحدة ولإشعارك بحالة طلباتك.

**Privacy notice.** We collect the minimum information needed to manage visitor access and keep residents safe: full name, document type, number and expiry, nationality, mobile number, and visit details (villa, reason, times, actual entry and exit). It is used to verify visitors at the gate, let the administration approve visits, prevent unauthorized entry, and keep a security record. Only authorized administration and gate-security staff can see it, under role-based permissions. Pass QR codes contain no personal data. Your mobile number is used for one-time verification codes and status notifications.

Operators should adapt this text, including the contact details and retention period, before going live. The text lives in `packages/shared/src/i18n/{ar,en}.ts` under `privacy`.

## Personal data inventory

| Data | Where stored | Who can see it |
|---|---|---|
| Name, nationality, document type/number/expiry, mobile | `visitors`, plus immutable snapshots in `visitor_profile_versions` | Admin (full); security via exact lookup, at the gate and when registering a visitor; the visitor sees their own data masked |
| Visit details, decisions, gate events | `visits`, `visit_decisions`, `gate_events` | Admin (history); security (operational views); the visitor (own visits) |
| OTP challenges (ID, mobile, HMAC of the code) | `otp_challenges` (purged after ~1 day by maintenance) | Nobody through the API |
| Session tokens | Only SHA-256 hashes in `sessions` | — |
| Audit log | `audit_logs` (append-only); identity numbers and phones **masked**, IPs HMAC-hashed | Admin only |
| Notifications | `notifications`: type plus reference and villa only | Recipient |
| Push tokens | `push_tokens` | — |

**Not stored:** raw OTP codes, raw pass tokens, raw session tokens, passwords (scrypt hashes only), raw client IP addresses (HMAC only), photos (the camera is used only to decode QR codes).

**On devices:** the mobile app stores only the session token (keychain/keystore), the language preference, the last gate used on the scanner, and unfinished visit-request drafts, which contain no identity data. Identity data entered by staff stays in memory. Sign-out deletes the token, cached responses and drafts.

## Anti-enumeration design

- No public endpoint accepts an identity number and returns profile data.
- `request-otp` returns an identical response shape and status for registered, unregistered and mismatched identities, and the SMS is dispatched asynchronously so timing does not reveal which case applied. A mismatched mobile **never** receives a code, and the challenge can never verify.
- Every failure (wrong code, expired, used, mismatched) returns the same `otp_invalid` error.
- Rate limits apply per IP, per identity number (hashed) and per mobile (hashed), plus a resend cool-down.
- Recovery when a visitor has lost the registered mobile is staff-assisted: staff check the original ID, then record the new mobile with a reason. The change is audited and ends the visitor's sessions.

## Security controls (implemented)

- Role checks on every protected action, on the server.
- Opaque session tokens. Web cookie: `HttpOnly`, `SameSite=Lax`, with the `__Host-` prefix and `Secure` on HTTPS. Mobile: SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- CSRF defenses: JSON-only bodies for state-changing requests, plus an `Origin` allow-list for cookie-authenticated requests.
- scrypt password hashing; 15-minute lockout after 5 failures; mandatory change of temporary passwords.
- Zod validation of every input. Parameterized SQL only. Database errors mapped to generic codes so row data never leaks.
- Content-Security-Policy with per-request nonces, `frame-ancestors 'none'`, no-referrer, HSTS in production.
- QR pass tokens derived with HMAC and stored as hashes; the token travels in the URL fragment.
- Concurrency safety: row locks plus unique, exclusion and partial-unique constraints.
- Append-only audit log enforced by a database trigger; decisions, gate events and profile versions are immutable too.
- Production start-up refuses insecure configuration.

## Retention (to be decided by the operator)

The software does **not** delete visit history automatically, because the security value of the log depends on the operator's policy. Suggested starting points to review with legal and privacy advisers:

| Data | Suggested retention | Implementation note |
|---|---|---|
| OTP challenges, expired sessions, rate-limit windows | ~1 day | Already purged by `runMaintenance` |
| Visits, gate events, decisions | e.g. 12–24 months | Add a scheduled job that anonymizes or deletes old rows; the audit trigger permits inserts only, so audit retention needs a privileged maintenance procedure |
| Visitor profiles with no visits in the retention period | Delete or anonymize | Must cascade to profile versions (currently protected by an immutability trigger) |
| Audit log | Per policy (often longer than visits) | Archive to cold storage before deletion |

## Operational recommendations

- Rotate `PASS_TOKEN_SECRET` only when necessary; it invalidates every outstanding pass. Rotating `OTP_SECRET` invalidates pending OTPs and resets rate-limit buckets.
- Restrict database network access; use TLS to the database; encrypt backups.
- Review the audit log regularly (failed sign-ins, lookups, profile changes).
- Keep staff accounts individual (no shared logins); deactivate leavers promptly (this revokes their sessions).
