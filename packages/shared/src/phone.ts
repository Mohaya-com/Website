import { parsePhoneNumberFromString, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min';
import { DEFAULT_COUNTRY } from './constants';
import { normalizeDigits } from './digits';

export type PhoneValidationError = 'required' | 'invalid' | 'not_mobile';

/**
 * Normalizes a phone number to E.164. Accepts Arabic or Western digits, local formats (05xxxxxxxx),
 * international formats (+9665…, 009665…). The default country is Saudi Arabia.
 */
export function normalizePhone(
  raw: string,
  defaultCountry: string = DEFAULT_COUNTRY,
): { ok: true; e164: string; country: string | undefined } | { ok: false; error: PhoneValidationError } {
  let value = normalizeDigits(raw ?? '').replace(/[\s\-().‎‏]/g, '');
  if (!value) return { ok: false, error: 'required' };
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  const parsed = parsePhoneNumberFromString(value, defaultCountry as CountryCode);
  if (!parsed || !parsed.isValid()) return { ok: false, error: 'invalid' };
  // Saudi numbers must be mobile numbers (5xxxxxxxx) because they receive OTP codes by SMS.
  if (parsed.country === 'SA' && !/^5\d{8}$/.test(parsed.nationalNumber)) {
    return { ok: false, error: 'not_mobile' };
  }
  return { ok: true, e164: parsed.number, country: parsed.country };
}

export function formatPhoneDisplay(e164: string | null | undefined): string {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/** +966 5• ••• 4567 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const last = e164.slice(-4);
  const parsed = parsePhoneNumberFromString(e164);
  const cc = parsed ? `+${parsed.countryCallingCode}` : e164.slice(0, 4);
  return `${cc} •••• ${last}`;
}

export function callingCodeFor(country: string): string {
  try {
    return getCountryCallingCode(country as CountryCode);
  } catch {
    return '';
  }
}
