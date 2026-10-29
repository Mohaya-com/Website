import type { DocumentType } from './constants';
import { normalizeIdentifier } from './digits';

export type DocumentValidationError = 'required' | 'digits_only' | 'length' | 'prefix' | 'checksum';

/**
 * Saudi national IDs and residency permits (Iqama) are 10-digit numbers.
 * National IDs start with 1, Iqama numbers start with 2, and both carry a Luhn (mod 10) check digit.
 */
export const DOCUMENT_RULES: Record<DocumentType, { length: number; prefix: string }> = {
  national_id: { length: 10, prefix: '1' },
  iqama: { length: 10, prefix: '2' },
};

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[i]);
    // Double every second digit counted from the left (positions 0, 2, 4, ...) for 10-digit numbers,
    // which is the same as doubling every second digit from the right excluding the check digit.
    if ((digits.length - i) % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function normalizeDocumentNumber(input: string): string {
  return normalizeIdentifier(input);
}

export function validateDocumentNumber(
  type: DocumentType,
  raw: string,
  options: { checksum?: boolean } = {},
): { ok: true; value: string } | { ok: false; error: DocumentValidationError } {
  const value = normalizeDocumentNumber(raw);
  if (!value) return { ok: false, error: 'required' };
  if (!/^\d+$/.test(value)) return { ok: false, error: 'digits_only' };
  const rule = DOCUMENT_RULES[type];
  if (value.length !== rule.length) return { ok: false, error: 'length' };
  if (!value.startsWith(rule.prefix)) return { ok: false, error: 'prefix' };
  if (options.checksum !== false && !luhnValid(value)) return { ok: false, error: 'checksum' };
  return { ok: true, value };
}

/** Infers the document type from the first digit, when possible. */
export function inferDocumentType(raw: string): DocumentType | null {
  const v = normalizeDocumentNumber(raw);
  if (v.startsWith('1')) return 'national_id';
  if (v.startsWith('2')) return 'iqama';
  return null;
}

/** Masks a document number for list views: 1•••••4321 */
export function maskDocumentNumber(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${value.slice(0, 1)}${'•'.repeat(Math.max(0, value.length - 5))}${value.slice(-4)}`;
}

/** Computes a valid check digit for a 9-digit prefix (used by development seed data and tests). */
export function withLuhnCheckDigit(prefix9: string): string {
  for (let d = 0; d <= 9; d++) {
    const candidate = `${prefix9}${d}`;
    if (luhnValid(candidate)) return candidate;
  }
  throw new Error('unreachable');
}
