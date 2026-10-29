import type { GateAction } from './constants';

/** Result codes for gate scans. Each maps to `scan.codes.<code>` in the translations. */
export const SCAN_CODES = [
  'entry_allowed',
  'exit_allowed',
  'entry_recorded',
  'exit_recorded',
  'invalid_pass',
  'pass_revoked',
  'not_approved',
  'rejected',
  'cancelled',
  'expired',
  'too_early',
  'window_closed',
  'document_expired',
  'already_checked_in',
  'already_completed',
  'not_checked_in',
  'gate_not_allowed',
  'visitor_inside_elsewhere',
  'identity_not_confirmed',
] as const;
export type ScanCode = (typeof SCAN_CODES)[number];

export const SUCCESS_SCAN_CODES: readonly ScanCode[] = ['entry_allowed', 'exit_allowed', 'entry_recorded', 'exit_recorded'];

/** Visit pass tokens: 32 random bytes, base64url without padding (43 characters). */
export const PASS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Pass QR codes encode a link whose token lives in the URL fragment (#…), so it is never sent to
 * a web server or written to access logs when opened in a browser. No personal data is encoded.
 */
export function buildPassQrValue(appOrigin: string, token: string): string {
  return `${appOrigin.replace(/\/$/, '')}/p#${token}`;
}

/** Extracts a pass token from a scanned value (full link, fragment, or the bare token). */
export function extractPassToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (PASS_TOKEN_PATTERN.test(value)) return value;
  const hashIndex = value.indexOf('#');
  if (hashIndex >= 0) {
    const fragment = value.slice(hashIndex + 1).replace(/^t=/, '');
    if (PASS_TOKEN_PATTERN.test(fragment)) return fragment;
  }
  const pathMatch = /\/p\/([A-Za-z0-9_-]{43})(?:[/?#]|$)/.exec(value);
  if (pathMatch?.[1]) return pathMatch[1];
  return null;
}

/** Printable gate QR links identify only the gate and the action. They never authorize entry by themselves. */
export function buildGateUrl(appOrigin: string, gateCode: string, action: GateAction): string {
  return `${appOrigin.replace(/\/$/, '')}/g/${encodeURIComponent(gateCode)}?a=${action}`;
}

export const GATE_CODE_PATTERN = /^[A-Za-z0-9]{6,16}$/;

export function parseGateUrl(raw: string | null | undefined): { code: string; action: GateAction } | null {
  if (!raw) return null;
  const m = /\/g\/([A-Za-z0-9]{6,16})(?:\/?\?a=(entry|exit)|\/(entry|exit))?/.exec(raw.trim());
  if (!m?.[1]) return null;
  const action = (m[2] ?? m[3] ?? 'entry') as GateAction;
  return { code: m[1], action };
}
