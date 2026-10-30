import { COUNTRIES } from './countries';
import { normalizeDigits } from './digits';
import { hijriToGregorian } from './hijri';
import { inferDocumentType, luhnValid } from './identity';
import type { DocumentType } from './constants';

/** Fields suggested from the text of an ID / Iqama photo. Every field is optional and must be confirmed. */
export interface IdScanFields {
  /** Saudi national ID, Iqama, or a passport read from its machine-readable zone. */
  documentKind?: DocumentType | 'passport';
  documentType?: DocumentType;
  documentNumber?: string;
  fullName?: string;
  nationality?: string;
  expiry?: { calendar: 'gregorian' | 'hijri'; date: string };
}

const NAME_STOPWORDS = new Set([
  'KINGDOM', 'SAUDI', 'ARABIA', 'MINISTRY', 'INTERIOR', 'RESIDENT', 'RESIDENCE', 'IDENTITY', 'NATIONAL', 'CARD', 'ID', 'IQAMA',
  'NAME', 'NATIONALITY', 'EXPIRY', 'DATE', 'BIRTH', 'ISSUE', 'PLACE', 'RELIGION', 'EMPLOYER', 'PROFESSION', 'OCCUPATION', 'VERSION',
  'NUMBER', 'NO', 'OF', 'THE', 'PERMIT', 'GENERAL', 'DIRECTORATE', 'PASSPORTS', 'SEX', 'MALE', 'FEMALE', 'MUSLIM',
]);

const pad = (n: number) => String(n).padStart(2, '0');

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** 10-digit identity numbers (prefix 1 or 2) that pass the check digit. Spaces inside the number are tolerated. */
function findDocumentNumber(text: string): string | undefined {
  const candidates = new Set<string>();
  for (const m of text.matchAll(/(?<!\d)[12](?:[ ]?\d){9}(?!\d)/g)) candidates.add(m[0].replace(/ /g, ''));
  return [...candidates].find((c) => luhnValid(c));
}

interface FoundDate {
  calendar: 'gregorian' | 'hijri';
  date: string;
  gregorian: string;
}

function toDate(y: number, m: number, d: number): FoundDate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = `${y}-${pad(m)}-${pad(d)}`;
  if (y >= 1900 && y <= 2100) {
    const g = new Date(`${date}T00:00:00Z`);
    return Number.isNaN(g.getTime()) || g.getUTCDate() !== d ? null : { calendar: 'gregorian', date, gregorian: date };
  }
  if (y >= 1300 && y <= 1500 && d <= 30) {
    const gregorian = hijriToGregorian({ year: y, month: m, day: d });
    return gregorian ? { calendar: 'hijri', date, gregorian } : null;
  }
  return null;
}

/** The expiry is the latest date on the card that is not in the past (birth and issue dates are earlier). */
function findExpiry(text: string, today: string): IdScanFields['expiry'] {
  const found: FoundDate[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{4})\s?[/\-.]\s?(\d{1,2})\s?[/\-.]\s?(\d{1,2})(?!\d)/g)) {
    const f = toDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (f) found.push(f);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s?[/\-.]\s?(\d{1,2})\s?[/\-.]\s?(\d{4})(?!\d)/g)) {
    const f = toDate(Number(m[3]), Number(m[2]), Number(m[1]));
    if (f) found.push(f);
  }
  const future = found.filter((f) => f.gregorian >= today).sort((a, b) => (a.gregorian < b.gregorian ? 1 : -1));
  const best = future[0] ?? found.sort((a, b) => (a.gregorian < b.gregorian ? 1 : -1))[0];
  return best ? { calendar: best.calendar, date: best.date } : undefined;
}

/**
 * Only a name next to an explicit label is taken ("Name:" or "الاسم"): photos of real cards produce
 * plenty of short garbage words, and a wrong name is worse than an empty optional field.
 */
function findName(lines: string[]): string | undefined {
  for (const line of lines) {
    const latin = /\bNAME\s*[:.]?\s*([A-Z][A-Z' -]{3,})$/.exec(line);
    if (latin) {
      const words = latin[1]!.split(/\s+/).filter((w) => !NAME_STOPWORDS.has(w));
      if (words.length >= 2 && words.every((w) => w.length >= 2) && words.filter((w) => w.length >= 3).length >= 2) return titleCase(words.join(' '));
    }
    const arabic = /الاسم\s*[:：]?\s*([\u0621-\u064A\s]{5,})/.exec(line);
    if (arabic) {
      const words = arabic[1]!.trim().split(/\s+/).filter((w) => w.length >= 2);
      if (words.length >= 2) return words.join(' ');
    }
  }
  return undefined;
}

function findNationality(text: string, documentType: DocumentType | undefined): string | undefined {
  if (documentType === 'national_id') return 'SA';
  const m = /NATIONALITY\s*[:.]?\s*([A-Z][A-Z ]{2,40})/.exec(text);
  if (!m) return undefined;
  const value = m[1]!.trim();
  const country = COUNTRIES.find((c) => value.startsWith(c.en.toUpperCase()) || c.en.toUpperCase().startsWith(value));
  return country?.code;
}

// ───────────────────────────── Passports (machine-readable zone, ICAO 9303 TD3) ─────────────────────────────

/** ISO 3166 alpha-3 → alpha-2 for the nationalities most often seen at Saudi compounds. */
const ALPHA3: Record<string, string> = {
  SAU: 'SA', ARE: 'AE', KWT: 'KW', QAT: 'QA', BHR: 'BH', OMN: 'OM', YEM: 'YE', EGY: 'EG', JOR: 'JO', SYR: 'SY', LBN: 'LB', PSE: 'PS',
  IRQ: 'IQ', SDN: 'SD', LBY: 'LY', TUN: 'TN', DZA: 'DZ', MAR: 'MA', MRT: 'MR', SOM: 'SO', DJI: 'DJ', COM: 'KM', ERI: 'ER', ETH: 'ET',
  KEN: 'KE', UGA: 'UG', TZA: 'TZ', NGA: 'NG', GHA: 'GH', IND: 'IN', PAK: 'PK', BGD: 'BD', NPL: 'NP', LKA: 'LK', AFG: 'AF', IRN: 'IR',
  PHL: 'PH', IDN: 'ID', MYS: 'MY', THA: 'TH', VNM: 'VN', CHN: 'CN', JPN: 'JP', KOR: 'KR', TUR: 'TR', GBR: 'GB', USA: 'US', CAN: 'CA',
  AUS: 'AU', NZL: 'NZ', IRL: 'IE', FRA: 'FR', DEU: 'DE', D: 'DE', ITA: 'IT', ESP: 'ES', PRT: 'PT', NLD: 'NL', BEL: 'BE', CHE: 'CH',
  AUT: 'AT', SWE: 'SE', NOR: 'NO', DNK: 'DK', FIN: 'FI', POL: 'PL', ROU: 'RO', RUS: 'RU', UKR: 'UA', ZAF: 'ZA', BRA: 'BR', MEX: 'MX',
};

function mrzCheckDigit(value: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    const v = c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55;
    sum += v * weights[i % 3]!;
  }
  return sum % 10;
}

/** Common OCR confusions in the MRZ font, applied only where the field must be numeric. */
const toDigits = (s: string) => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');

function parseMrz(text: string): IdScanFields | null {
  const lines = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, '').replace(/[«‹]/g, '<'))
    .filter((l) => l.length >= 40 && l.includes('<'));
  for (let i = 0; i + 1 < lines.length; i++) {
    const l1 = lines[i]!.padEnd(44, '<').slice(0, 44);
    const l2 = lines[i + 1]!.padEnd(44, '<').slice(0, 44);
    if (!l1.startsWith('P')) continue;
    const number = l2.slice(0, 9);
    const numberCheck = toDigits(l2[9]!);
    if (mrzCheckDigit(number) !== Number(numberCheck)) continue;
    const nationality3 = l2.slice(10, 13).replace(/</g, '');
    const [surname = '', given = ''] = l1.slice(5).split('<<');
    const name = `${given.replace(/</g, ' ')} ${surname.replace(/</g, ' ')}`.replace(/\s+/g, ' ').trim();
    const result: IdScanFields = { documentKind: 'passport', documentNumber: number.replace(/</g, '') };
    if (/^[A-Z ]{3,}$/.test(name) && name.includes(' ')) result.fullName = titleCase(name);
    const nationality = ALPHA3[nationality3];
    if (nationality) result.nationality = nationality;
    const expiry = toDigits(l2.slice(21, 27));
    if (/^\d{6}$/.test(expiry) && mrzCheckDigit(expiry) === Number(toDigits(l2[27]!))) {
      result.expiry = { calendar: 'gregorian', date: `20${expiry.slice(0, 2)}-${expiry.slice(2, 4)}-${expiry.slice(4, 6)}` };
    }
    return result;
  }
  return null;
}

/** Extracts what it can from OCR text. `today` is the compound's current date (YYYY-MM-DD). */
export function parseIdText(raw: string, today: string): IdScanFields {
  const passport = parseMrz(normalizeDigits(raw));
  if (passport) return passport;
  const text = normalizeDigits(raw).toUpperCase().replace(/[|]/g, ' ');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const documentNumber = findDocumentNumber(text);
  const documentType = documentNumber ? (inferDocumentType(documentNumber) ?? undefined) : undefined;
  const result: IdScanFields = {};
  if (documentNumber) result.documentNumber = documentNumber;
  if (documentType) {
    result.documentType = documentType;
    result.documentKind = documentType;
  }
  const fullName = findName(lines);
  if (fullName) result.fullName = fullName;
  const nationality = findNationality(text, documentType);
  if (nationality) result.nationality = nationality;
  const expiry = findExpiry(text, today);
  if (expiry) result.expiry = expiry;
  return result;
}
