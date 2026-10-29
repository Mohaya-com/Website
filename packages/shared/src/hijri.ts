import { isValidYmd } from './time';

/**
 * Hijri (Umm al-Qura) ↔ Gregorian conversion built on the platform's Intl calendar data.
 * The server is authoritative: clients use these helpers for previews only, and the server
 * re-computes the Gregorian date from the Hijri input before storing it.
 */

export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

let hijriFormatter: Intl.DateTimeFormat | null | undefined;

function getHijriFormatter(): Intl.DateTimeFormat | null {
  if (hijriFormatter !== undefined) return hijriFormatter;
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    hijriFormatter = f.resolvedOptions().calendar === 'islamic-umalqura' ? f : null;
  } catch {
    hijriFormatter = null;
  }
  return hijriFormatter;
}

/** True when this runtime can convert Hijri (Umm al-Qura) dates. */
export function isHijriSupported(): boolean {
  return getHijriFormatter() !== null;
}

function hijriPartsOfUtcNoon(ms: number): HijriDate | null {
  const f = getHijriFormatter();
  if (!f) return null;
  const parts = f.formatToParts(new Date(ms));
  const num = (t: string) => Number((parts.find((p) => p.type === t)?.value ?? '').replace(/\D/g, ''));
  const year = num('year') || num('relatedYear');
  return { year, month: num('month'), day: num('day') };
}

export function gregorianToHijri(ymd: string): HijriDate | null {
  if (!isValidYmd(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return hijriPartsOfUtcNoon(Date.UTC(y, m - 1, d, 12));
}

const HIJRI_EPOCH_MS = Date.UTC(622, 6, 19, 12); // ≈ 1 Muharram 1 AH
const MEAN_YEAR_DAYS = 354.36667;
const MEAN_MONTH_DAYS = 29.530589;
const DAY_MS = 86_400_000;

/** Converts a Hijri (Umm al-Qura) date to Gregorian YYYY-MM-DD, or null when invalid/unsupported. */
export function hijriToGregorian(h: HijriDate): string | null {
  if (!getHijriFormatter()) return null;
  if (!Number.isInteger(h.year) || !Number.isInteger(h.month) || !Number.isInteger(h.day)) return null;
  if (h.year < 1300 || h.year > 1600 || h.month < 1 || h.month > 12 || h.day < 1 || h.day > 30) return null;
  const approxDays = Math.round((h.year - 1) * MEAN_YEAR_DAYS + (h.month - 1) * MEAN_MONTH_DAYS + (h.day - 1));
  const approx = HIJRI_EPOCH_MS + approxDays * DAY_MS;
  for (let offset = 0; offset <= 45; offset++) {
    for (const sign of offset === 0 ? [1] : [1, -1]) {
      const ms = approx + sign * offset * DAY_MS;
      const parts = hijriPartsOfUtcNoon(ms);
      if (parts && parts.year === h.year && parts.month === h.month && parts.day === h.day) {
        const dt = new Date(ms);
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

export function formatHijri(h: HijriDate | null): string {
  if (!h) return '—';
  return `${h.year}/${String(h.month).padStart(2, '0')}/${String(h.day).padStart(2, '0')} هـ`;
}
