import { DEFAULT_TIMEZONE, type Locale } from './constants';

/**
 * Time-zone helpers. All timestamps are stored and transmitted in UTC (ISO 8601).
 * Wall-clock values (dates and times typed by users) are interpreted in the compound time zone,
 * which defaults to Asia/Riyadh (UTC+03:00, no daylight saving time).
 */

const KNOWN_FIXED_OFFSETS: Record<string, number> = {
  'Asia/Riyadh': 180,
  'Asia/Dubai': 240,
  'Asia/Qatar': 180,
  'Asia/Kuwait': 180,
  'Asia/Bahrain': 180,
  UTC: 0,
};

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Returns the wall-clock parts of `date` in `timeZone`. Falls back to known fixed offsets if Intl lacks time-zone data. */
export function zonedParts(date: Date, timeZone: string = DEFAULT_TIMEZONE): ZonedParts {
  try {
    const parts = partsFormatter(timeZone).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
    const hour = Number(get('hour')) % 24;
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      hour,
      minute: Number(get('minute')),
      second: Number(get('second')),
      weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
    };
  } catch {
    const offset = KNOWN_FIXED_OFFSETS[timeZone] ?? 0;
    const shifted = new Date(date.getTime() + offset * 60_000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
      weekday: shifted.getUTCDay(),
    };
  }
}

/** Offset of `timeZone` from UTC at `date`, in minutes (Asia/Riyadh → 180). */
export function timeZoneOffsetMinutes(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD for the given instant in the compound time zone. */
export function zonedDateString(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** HH:mm for the given instant in the compound time zone. */
export function zonedTimeString(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Converts a wall-clock date (YYYY-MM-DD) and time (HH:mm) in `timeZone` to a UTC Date. */
export function zonedDateTimeToUtc(dateYmd: string, timeHm: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const [hh, mm] = timeHm.split(':').map(Number);
  if (!y || !m || !d || hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) {
    throw new RangeError('Invalid date or time');
  }
  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two iterations handle DST transitions for zones that observe them.
  let guess = naiveUtc - timeZoneOffsetMinutes(new Date(naiveUtc), timeZone) * 60_000;
  guess = naiveUtc - timeZoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** Start of the day (00:00) in `timeZone` for the instant, as a UTC Date. */
export function startOfZonedDay(date: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  return zonedDateTimeToUtc(zonedDateString(date, timeZone), '00:00', timeZone);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

// ───────────────────────────── Display formatting ─────────────────────────────

const LOCALE_TAGS: Record<Locale, string> = {
  // Explicit Gregorian calendar and Latin digits: ar-SA would otherwise default to the Hijri calendar.
  ar: 'ar-SA-u-ca-gregory-nu-latn',
  en: 'en-GB-u-ca-gregory',
};

const displayFormatterCache = new Map<string, Intl.DateTimeFormat | null>();

function displayFormatter(locale: Locale, timeZone: string, kind: 'datetime' | 'date' | 'time' | 'weekdayDate'): Intl.DateTimeFormat | null {
  const key = `${locale}|${timeZone}|${kind}`;
  if (displayFormatterCache.has(key)) return displayFormatterCache.get(key) ?? null;
  let f: Intl.DateTimeFormat | null = null;
  try {
    const base: Intl.DateTimeFormatOptions = { timeZone };
    const opts: Intl.DateTimeFormatOptions =
      kind === 'datetime'
        ? { ...base, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
        : kind === 'date'
          ? { ...base, year: 'numeric', month: 'short', day: 'numeric' }
          : kind === 'weekdayDate'
            ? { ...base, weekday: 'long', month: 'long', day: 'numeric' }
            : { ...base, hour: 'numeric', minute: '2-digit' };
    f = new Intl.DateTimeFormat(LOCALE_TAGS[locale], opts);
  } catch {
    f = null;
  }
  displayFormatterCache.set(key, f);
  return f;
}

function fallbackFormat(date: Date, timeZone: string, kind: 'datetime' | 'date' | 'time' | 'weekdayDate'): string {
  const p = zonedParts(date, timeZone);
  const d = `${p.year}/${pad2(p.month)}/${pad2(p.day)}`;
  const t = `${pad2(p.hour)}:${pad2(p.minute)}`;
  return kind === 'date' || kind === 'weekdayDate' ? d : kind === 'time' ? t : `${d} ${t}`;
}

export function formatDateTime(value: Date | string | null | undefined, locale: Locale, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return displayFormatter(locale, timeZone, 'datetime')?.format(date) ?? fallbackFormat(date, timeZone, 'datetime');
}

export function formatDate(value: Date | string | null | undefined, locale: Locale, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return displayFormatter(locale, timeZone, 'date')?.format(date) ?? fallbackFormat(date, timeZone, 'date');
}

export function formatTime(value: Date | string | null | undefined, locale: Locale, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return displayFormatter(locale, timeZone, 'time')?.format(date) ?? fallbackFormat(date, timeZone, 'time');
}

export function formatWeekdayDate(value: Date | string, locale: Locale, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return displayFormatter(locale, timeZone, 'weekdayDate')?.format(date) ?? fallbackFormat(date, timeZone, 'weekdayDate');
}

/** Formats a calendar date string (YYYY-MM-DD, no time zone) for display. */
export function formatYmd(ymd: string | null | undefined, locale: Locale): string {
  if (!ymd || !isValidYmd(ymd)) return '—';
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return formatDate(new Date(Date.UTC(y, m - 1, d, 12)), locale, 'UTC');
}

/** "2 ساعة 30 دقيقة" / "2h 30m" */
export function formatDuration(totalMinutes: number, locale: Locale): string {
  const h = Math.floor(Math.abs(totalMinutes) / 60);
  const m = Math.abs(totalMinutes) % 60;
  if (locale === 'ar') {
    const hours = h === 0 ? '' : h === 1 ? 'ساعة' : h === 2 ? 'ساعتان' : h <= 10 ? `${h} ساعات` : `${h} ساعة`;
    const mins = m === 0 ? '' : m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتان' : m <= 10 ? `${m} دقائق` : `${m} دقيقة`;
    if (!hours && !mins) return '0 دقيقة';
    return [hours, mins].filter(Boolean).join(' و');
  }
  if (!h && !m) return '0 min';
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}
