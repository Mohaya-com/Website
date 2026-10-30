import { describe, expect, it } from 'vitest';
import {
  canTransition,
  parseIdText,
  computeEntryWindow,
  computeExpectedExit,
  createTranslator,
  documentExpiryInputSchema,
  en,
  ar,
  extractPassToken,
  buildPassQrValue,
  gregorianToHijri,
  hijriToGregorian,
  isDocumentValidOn,
  isOverdue,
  maskDocumentNumber,
  normalizeDigits,
  normalizeIdentifier,
  normalizePhone,
  parseGateUrl,
  buildGateUrl,
  validateDocumentNumber,
  withLuhnCheckDigit,
  zonedDateTimeToUtc,
  zonedDateString,
  visitRequestSchema,
  VISIT_STATUSES,
} from './index';

describe('digit normalization', () => {
  it('converts Arabic-Indic and Persian digits', () => {
    expect(normalizeDigits('١٠١٢٣٤٥٦٧٨')).toBe('1012345678');
    expect(normalizeDigits('۲۰۱۲')).toBe('2012');
    expect(normalizeIdentifier(' ١٠١ ٢٣٤-٥٦٧٨ ')).toBe('1012345678');
  });
});

describe('identity numbers', () => {
  const nid = withLuhnCheckDigit('101234567');
  const iqama = withLuhnCheckDigit('234567890');

  it('accepts valid national IDs and iqama numbers (Arabic digits too)', () => {
    expect(validateDocumentNumber('national_id', nid)).toEqual({ ok: true, value: nid });
    const arabic = nid.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    expect(validateDocumentNumber('national_id', arabic)).toEqual({ ok: true, value: nid });
    expect(validateDocumentNumber('iqama', iqama).ok).toBe(true);
  });

  it('rejects wrong prefix, length and checksum', () => {
    expect(validateDocumentNumber('iqama', nid)).toEqual({ ok: false, error: 'prefix' });
    expect(validateDocumentNumber('national_id', '10123')).toEqual({ ok: false, error: 'length' });
    const bad = `${nid.slice(0, 9)}${(Number(nid[9]) + 1) % 10}`;
    expect(validateDocumentNumber('national_id', bad)).toEqual({ ok: false, error: 'checksum' });
    expect(validateDocumentNumber('national_id', bad, { checksum: false }).ok).toBe(true);
  });

  it('masks numbers for lists', () => {
    expect(maskDocumentNumber('1012345678')).toBe('1•••••5678');
  });
});

describe('phone numbers', () => {
  it('normalizes Saudi mobile formats to E.164', () => {
    for (const raw of ['0501234567', '501234567', '+966501234567', '00966501234567', '٠٥٠١٢٣٤٥٦٧']) {
      expect(normalizePhone(raw)).toMatchObject({ ok: true, e164: '+966501234567' });
    }
  });
  it('rejects Saudi landlines and supports international numbers', () => {
    expect(normalizePhone('0112345678')).toEqual({ ok: false, error: 'not_mobile' });
    expect(normalizePhone('+201001234567')).toMatchObject({ ok: true, e164: '+201001234567' });
    expect(normalizePhone('9876543210', 'IN')).toMatchObject({ ok: true, e164: '+919876543210' });
  });
});

describe('time zone handling', () => {
  it('interprets wall-clock times in Asia/Riyadh (UTC+3)', () => {
    expect(zonedDateTimeToUtc('2026-11-01', '09:30', 'Asia/Riyadh').toISOString()).toBe('2026-11-01T06:30:00.000Z');
    expect(zonedDateString(new Date('2026-11-01T22:30:00Z'), 'Asia/Riyadh')).toBe('2026-11-02');
  });
});

describe('hijri conversion', () => {
  it('round-trips Umm al-Qura dates', () => {
    const h = gregorianToHijri('2026-11-01');
    expect(h).not.toBeNull();
    expect(hijriToGregorian(h!)).toBe('2026-11-01');
  });
  it('normalizes hijri expiry input to a gregorian date', () => {
    const h = gregorianToHijri('2028-03-15')!;
    const parsed = documentExpiryInputSchema.parse({ calendar: 'hijri', date: `${h.year}-${h.month}-${h.day}` });
    expect(parsed.gregorian).toBe('2028-03-15');
    expect(parsed.calendar).toBe('hijri');
  });
});

describe('business rules', () => {
  it('only permits the documented transitions', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'checked_in')).toBe(false);
    expect(canTransition('approved', 'checked_in')).toBe(true);
    expect(canTransition('checked_in', 'completed')).toBe(true);
    expect(canTransition('checked_in', 'cancelled')).toBe(false);
    expect(canTransition('completed', 'checked_in')).toBe(false);
    for (const terminal of ['rejected', 'completed', 'cancelled', 'expired'] as const) {
      for (const to of VISIT_STATUSES) expect(canTransition(terminal, to)).toBe(false);
    }
  });

  it('computes expected exit and the entry window (capped at expected exit)', () => {
    const entry = new Date('2026-11-01T06:00:00Z');
    const exit = computeExpectedExit(entry, 60);
    expect(exit.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    const w = computeEntryWindow(entry, exit, { entryWindowEarlyMinutes: 30, entryWindowLateMinutes: 120 });
    expect(w.start.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });

  it('treats documents as valid through the expiry date', () => {
    expect(isDocumentValidOn('2026-11-01', '2026-11-01')).toBe(true);
    expect(isDocumentValidOn('2026-10-31', '2026-11-01')).toBe(false);
  });

  it('flags overdue visitors without changing their status', () => {
    const v = { status: 'checked_in' as const, expectedExitAt: '2026-11-01T07:00:00Z' };
    expect(isOverdue(v, new Date('2026-11-01T07:10:00Z'), 15)).toBe(false);
    expect(isOverdue(v, new Date('2026-11-01T07:16:00Z'), 15)).toBe(true);
    expect(isOverdue({ ...v, status: 'completed' }, new Date('2026-11-02T00:00:00Z'))).toBe(false);
  });

  it('requires details when the reason is "other"', () => {
    const base = {
      villaId: '6f1c7a52-6a55-4d55-9f56-4a0c7d2f0b11',
      requestedEntryAt: '2026-11-01T06:00:00.000Z',
      durationMinutes: 60,
      clientRequestId: '3d0f4d0e-1d5c-4d1e-8a8e-5f1b2c3d4e5f',
    };
    expect(visitRequestSchema.safeParse({ ...base, reason: 'other' }).success).toBe(false);
    expect(visitRequestSchema.safeParse({ ...base, reason: 'other', reasonDetails: 'Moving furniture' }).success).toBe(true);
    expect(visitRequestSchema.safeParse({ ...base, reason: 'delivery' }).success).toBe(true);
  });
});

describe('QR payloads', () => {
  const token = 'A'.repeat(20) + 'b_-'.repeat(7) + 'xy';
  it('encodes the pass token in the fragment and parses it back', () => {
    expect(token).toHaveLength(43);
    const value = buildPassQrValue('https://vms.example.com/', token);
    expect(value).toBe(`https://vms.example.com/p#${token}`);
    expect(extractPassToken(value)).toBe(token);
    expect(extractPassToken(token)).toBe(token);
    expect(extractPassToken('https://evil.example.com/p#short')).toBeNull();
  });
  it('builds gate links that carry no personal data', () => {
    const url = buildGateUrl('https://vms.example.com', 'K7Q4M2XA', 'exit');
    expect(url).toBe('https://vms.example.com/g/K7Q4M2XA?a=exit');
    expect(parseGateUrl(url)).toEqual({ code: 'K7Q4M2XA', action: 'exit' });
  });
});

describe('translations', () => {
  it('provides the same keys in Arabic and English', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v as object, `${prefix}${k}.`)));
    expect(keys(en).sort()).toEqual(keys(ar).sort());
  });
  it('interpolates parameters and resolves dotted audit keys', () => {
    const t = createTranslator('ar');
    expect(t('visitor.homeGreeting', { name: 'سارة' })).toBe('أهلًا، سارة');
    expect(t.dynamic('audit.actions.visit.approved')).toBe('الموافقة على طلب');
    expect(createTranslator('en')('status.checked_in')).toBe('Inside the compound');
  });
});

describe('reading ID photo text', () => {
  const today = '2026-10-30';

  it('reads an Iqama: number (check digit verified), name, nationality and the future expiry date', () => {
    const text = 'KINGDOM OF SAUDI ARABIA\nRESIDENT IDENTITY\nID No: 2345678904\nName: MOHAMMED ASIF KHAN\nNationality: PAKISTAN\nDate of Birth: 1990/05/14\nExpiry Date: 2027/03/18';
    expect(parseIdText(text, today)).toEqual({
      documentNumber: '2345678904',
      documentType: 'iqama',
      documentKind: 'iqama',
      fullName: 'Mohammed Asif Khan',
      nationality: 'PK',
      expiry: { calendar: 'gregorian', date: '2027-03-18' },
    });
  });

  it('reads a national ID with Arabic-Indic digits, spaces inside the number and a Hijri expiry', () => {
    const number = withLuhnCheckDigit('104734313');
    const spaced = `${number.slice(0, 1)} ${number.slice(1, 4)} ${number.slice(4)}`.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
    const result = parseIdText(`المملكة العربية السعودية\nرقم الهوية ${spaced}\nتاريخ الانتهاء ١٤٥٢/٠٣/١٠\nتاريخ الميلاد ١٤١٠/٠١/٠١`, today);
    expect(result.documentNumber).toBe(number);
    expect(result.documentType).toBe('national_id');
    expect(result.nationality).toBe('SA');
    expect(result.expiry).toEqual({ calendar: 'hijri', date: '1452-03-10' });
  });

  it('takes a name only next to a label, never from stray words read off a real card', () => {
    expect(parseIdText('PS ERI IE\nAL MA LS\n12 3', today).fullName).toBeUndefined();
    expect(parseIdText('الاسم: أحمد جمال سالم', today).fullName).toBe('أحمد جمال سالم');
    expect(parseIdText('Name: SAMPLE TEST PERSON', today).fullName).toBe('Sample Test Person');
  });

  it('reads a passport from its machine-readable zone (ICAO 9303 specimen)', () => {
    const mrz = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
    expect(parseIdText(mrz, today)).toEqual({ documentKind: 'passport', documentNumber: 'L898902C3', fullName: 'Anna Maria Eriksson', expiry: { calendar: 'gregorian', date: '2012-04-15' } });
    const egyptian = 'P<EGYHASSAN<<AHMED<<<<<<<<<<<<<<<<<<<<<<<<<<\nA123456784EGY9001014M3012315<<<<<<<<<<<<<<04';
    expect(parseIdText(egyptian, today)).toMatchObject({ documentKind: 'passport', documentNumber: 'A12345678', nationality: 'EG', fullName: 'Ahmed Hassan' });
    // A wrong check digit means a misread line: nothing is taken from it.
    expect(parseIdText('P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C37UTO7408122F1204159ZE184226B<<<<<10', today).documentKind).toBeUndefined();
  });

  it('ignores numbers that fail the check digit and returns nothing it cannot match', () => {
    expect(parseIdText('ID 2345678900 random text', today).documentNumber).toBeUndefined();
    expect(parseIdText('', today)).toEqual({});
  });
});
