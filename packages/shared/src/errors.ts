/** API error codes. Each maps to `errors.<code>` in the translations. */
export const API_ERROR_CODES = [
  'validation_error',
  'unauthenticated',
  'session_expired',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'invalid_credentials',
  'password_change_required',
  'invalid_transition',
  'stale_version',
  'duplicate_visitor',
  'duplicate_request',
  'overlapping_visit',
  'document_expired',
  'window_passed',
  'otp_invalid',
  'sms_unavailable',
  'self_registration_disabled',
  'registration_required',
  'setup_unavailable',
  'villa_inactive',
  'gate_inactive',
  'csrf_failed',
  'cannot_modify_self',
  'last_admin',
  'username_taken',
  'villa_taken',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly fields?: Record<string, string>,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}
