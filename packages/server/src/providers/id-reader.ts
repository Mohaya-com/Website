import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { COUNTRY_CODES, inferDocumentType, luhnValid, normalizeDigits, parseIdText, type IdScanFields } from '@vms/shared';
import type { ServerConfig } from '../config';
import { describeError, logger } from '../logger';
import { recognizeText } from './ocr';

/**
 * Reads an ID / Iqama / passport photo. Two readers:
 *   • tesseract (default) - runs inside this server, free; reliable on passports (machine-readable zone)
 *     and Latin digits, but not on Arabic-Indic digits or Arabic names.
 *   • claude (opt-in: ID_READER=claude and ANTHROPIC_API_KEY) - sends the photo to the Claude API, which
 *     reads Arabic and Latin text, including the identity number in Arabic-Indic digits. Every value is
 *     still checked here (check digit, formats) and stays editable; on any failure the free reader is used.
 */

const ExtractedSchema = z.object({
  documentKind: z.enum(['national_id', 'iqama', 'passport', 'unknown']),
  documentNumber: z.string().nullable(),
  fullNameArabic: z.string().nullable(),
  fullNameLatin: z.string().nullable(),
  nationalityIso2: z.string().nullable(),
  expiryDate: z.string().nullable(),
  expiryCalendar: z.enum(['gregorian', 'hijri']).nullable(),
});

const PROMPT = `This is a photo of an identity document presented at a residential compound gate in Saudi Arabia: a Saudi national ID card, an Iqama (resident permit) or a passport.
Read it exactly as printed:
- documentNumber: the ID / Iqama number (10 digits; convert Arabic-Indic digits to 0-9) or the passport number.
- fullNameArabic / fullNameLatin: the holder's full name in each script if printed (null if not).
- nationalityIso2: the holder's nationality as an ISO 3166 alpha-2 code (SA for a Saudi national ID).
- expiryDate as YYYY-MM-DD and expiryCalendar (hijri when the year is 13xx-15xx).
Use null for anything you cannot read with confidence. Do not guess.`;

function clean(fields: z.infer<typeof ExtractedSchema>): IdScanFields {
  const out: IdScanFields = {};
  const number = fields.documentNumber ? normalizeDigits(fields.documentNumber).toUpperCase().replace(/[\s-]/g, '') : null;
  if (number && /^\d{10}$/.test(number) && luhnValid(number)) {
    out.documentNumber = number;
    const type = inferDocumentType(number);
    if (type) {
      out.documentType = type;
      out.documentKind = type;
    }
  } else if (number && fields.documentKind === 'passport' && /^[A-Z0-9]{5,20}$/.test(number)) {
    out.documentNumber = number;
    out.documentKind = 'passport';
  }
  const name = (fields.fullNameArabic ?? fields.fullNameLatin)?.replace(/\s+/g, ' ').trim();
  if (name && name.length >= 3 && name.length <= 120) out.fullName = name;
  const nationality = fields.nationalityIso2?.toUpperCase();
  if (nationality && COUNTRY_CODES.includes(nationality)) out.nationality = nationality;
  if (fields.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(normalizeDigits(fields.expiryDate)) && fields.expiryCalendar) {
    out.expiry = { calendar: fields.expiryCalendar, date: normalizeDigits(fields.expiryDate) };
  }
  return out;
}

let client: Anthropic | null = null;

async function readWithClaude(config: ServerConfig['idReader'], image: { type: string; bytes: Buffer }): Promise<IdScanFields | null> {
  client ??= new Anthropic({ timeout: 60_000, maxRetries: 1 });
  const response = await client.messages.parse({
    model: config.model,
    max_tokens: 2000,
    output_config: { effort: 'low', format: zodOutputFormat(ExtractedSchema) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.type as 'image/jpeg' | 'image/png' | 'image/webp', data: image.bytes.toString('base64') } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
  return clean(response.parsed_output);
}

/** Suggested fields from an ID photo, or null when nothing could be read. */
export async function readIdImage(config: ServerConfig, image: { type: string; bytes: Buffer }, today: string): Promise<IdScanFields | null> {
  if (config.idReader.provider === 'claude') {
    try {
      const fields = await readWithClaude(config.idReader, image);
      if (fields && Object.keys(fields).length) return fields;
    } catch (err) {
      if (err instanceof Anthropic.APIError) logger.warn('id_reader.claude_failed', { status: err.status, name: err.name });
      else logger.warn('id_reader.claude_failed', describeError(err));
    }
  }
  const text = await recognizeText(image.bytes);
  if (!text?.trim()) return null;
  return parseIdText(text, today);
}
