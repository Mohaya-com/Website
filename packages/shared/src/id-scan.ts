import { COUNTRIES } from './countries';
import { normalizeDigits } from './digits';
import { hijriToGregorian } from './hijri';
import { inferDocumentType, luhnValid } from './identity';
import type { DocumentType } from './constants';

/** Fields suggested from the text of an ID / Iqama photo. Every field is optional and must be confirmed. */
export interface IdScanFields {
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

function findName(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = /\bNAME\s*[:.]?\s*([A-Z][A-Z' -]{3,})$/.exec(line);
    if (m) {
      const words = m[1]!.split(/\s+/).filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w));
      if (words.length >= 2) return titleCase(words.join(' '));
    }
  }
  for (const line of lines) {
    if (!/^[A-Z][A-Z' -]+$/.test(line)) continue;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 6 || words.some((w) => NAME_STOPWORDS.has(w) || w.length < 2)) continue;
    return titleCase(words.join(' '));
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

/** Extracts what it can from OCR text. `today` is the compound's current date (YYYY-MM-DD). */
export function parseIdText(raw: string, today: string): IdScanFields {
  const text = normalizeDigits(raw).toUpperCase().replace(/[|]/g, ' ');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const documentNumber = findDocumentNumber(text);
  const documentType = documentNumber ? (inferDocumentType(documentNumber) ?? undefined) : undefined;
  const result: IdScanFields = {};
  if (documentNumber) result.documentNumber = documentNumber;
  if (documentType) result.documentType = documentType;
  const fullName = findName(lines);
  if (fullName) result.fullName = fullName;
  const nationality = findNationality(text, documentType);
  if (nationality) result.nationality = nationality;
  const expiry = findExpiry(text, today);
  if (expiry) result.expiry = expiry;
  return result;
}
