import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withLuhnCheckDigit } from '@vms/shared';

const parse = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500;
  }
  class Anthropic {
    static APIError = APIError;
    messages = { parse };
  }
  return { default: Anthropic };
});

const { readIdImage } = await import('../providers/id-reader');
const config = { idReader: { provider: 'claude', model: 'claude-haiku-5-5' } } as Parameters<typeof readIdImage>[0];
const PNG = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'sample-iqama.png'));
const image = { type: 'image/png', bytes: PNG };

beforeEach(() => parse.mockReset());

describe('ID reader with the Claude API (opt-in)', () => {
  it('converts Arabic-Indic digits, verifies the check digit and prefers the Arabic name', async () => {
    const number = withLuhnCheckDigit('104734313');
    const arabicDigits = number.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
    parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { documentKind: 'national_id', documentNumber: arabicDigits, fullNameArabic: 'أحمد جمال سالم', fullNameLatin: 'AHMAD JAMAL', nationalityIso2: 'sa', expiryDate: '1452-03-10', expiryCalendar: 'hijri' },
    });
    expect(await readIdImage(config, image, '2026-10-31')).toEqual({
      documentNumber: number,
      documentType: 'national_id',
      documentKind: 'national_id',
      fullName: 'أحمد جمال سالم',
      nationality: 'SA',
      expiry: { calendar: 'hijri', date: '1452-03-10' },
    });
    const request = parse.mock.calls[0]![0];
    expect(request.model).toBe('claude-haiku-5-5');
    expect(request.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
  });

  it('drops a number that fails the check digit', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: { documentKind: 'iqama', documentNumber: '2345678900', fullNameArabic: null, fullNameLatin: 'SAMPLE PERSON', nationalityIso2: null, expiryDate: null, expiryCalendar: null } });
    expect(await readIdImage(config, image, '2026-10-31')).toEqual({ fullName: 'SAMPLE PERSON' });
  });

  it('falls back to the free reader when the API fails or refuses', async () => {
    parse.mockRejectedValue(new Error('network'));
    expect((await readIdImage(config, image, '2026-10-31'))?.documentNumber).toBe('2345678904');
    parse.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null });
    expect((await readIdImage(config, image, '2026-10-31'))?.documentNumber).toBe('2345678904');
  }, 60_000);
});
