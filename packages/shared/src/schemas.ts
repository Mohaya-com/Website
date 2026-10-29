import { z } from 'zod';
import {
  CALENDARS,
  CLIENT_KINDS,
  DOCUMENT_TYPES,
  GATE_ACTIONS,
  LOCALES,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  STAFF_ROLES,
  VISIT_REASONS,
  VISIT_STATUSES,
  OTP,
} from './constants';
import { COUNTRY_CODES } from './countries';
import { normalizeDigits, normalizeIdentifier } from './digits';
import { validateDocumentNumber } from './identity';
import { normalizePhone } from './phone';
import { isValidYmd } from './time';
import { hijriToGregorian } from './hijri';
import { systemSettingsSchema } from './settings';

/** All validation messages are translation keys so every client can show them in Arabic or English. */
const e = (key: string) => ({ error: key });

const requiredString = (max: number) =>
  z
    .string(e('validation.required'))
    .trim()
    .min(1, e('validation.required'))
    .max(max, e('validation.tooLong'));

export const idSchema = z.uuid(e('validation.invalid'));

// ───────────────────────────── Identity & profile fields ─────────────────────────────

export const fullNameSchema = z
  .string(e('validation.required'))
  .trim()
  .min(1, e('validation.required'))
  .max(120, e('validation.tooLong'))
  .transform((v) => v.replace(/\s+/g, ' '))
  .refine((v) => v.split(' ').filter(Boolean).length >= 2, e('validation.fullNameWords'))
  .refine((v) => !/[<>{}\\]/.test(v) && !/\d/.test(normalizeDigits(v)), e('validation.fullNameChars'));

export const documentTypeSchema = z.enum(DOCUMENT_TYPES, e('validation.required'));
export const nationalitySchema = z
  .string(e('validation.required'))
  .trim()
  .toUpperCase()
  .refine((v) => (COUNTRY_CODES as readonly string[]).includes(v), e('validation.required'));

/**
 * Document expiry input. The calendar is explicit: Gregorian (ميلادي) or Hijri Umm al-Qura (هجري).
 * The output is always normalized to a Gregorian ISO date plus the original input for reference.
 */
export const documentExpiryInputSchema = z
  .object({
    calendar: z.enum(CALENDARS),
    date: z.string(e('validation.required')).trim().transform((v) => normalizeDigits(v)),
  })
  .transform((v, ctx) => {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.date);
    if (!m) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'validation.invalidDate' });
      return z.NEVER;
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (v.calendar === 'gregorian') {
      const ymd = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!isValidYmd(ymd) || y < 1900 || y > 2200) {
        ctx.addIssue({ code: 'custom', path: ['date'], message: 'validation.invalidDate' });
        return z.NEVER;
      }
      return { calendar: 'gregorian' as const, gregorian: ymd, original: ymd };
    }
    const g = hijriToGregorian({ year: y, month: mo, day: d });
    if (!g) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'validation.invalidHijriDate' });
      return z.NEVER;
    }
    const original = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { calendar: 'hijri' as const, gregorian: g, original };
  });
export type DocumentExpiryInput = z.input<typeof documentExpiryInputSchema>;
export type DocumentExpiryNormalized = z.output<typeof documentExpiryInputSchema>;

export const mobileInputSchema = z.object({
  mobile: z.string(e('validation.required')).trim().max(32, e('validation.tooLong')),
  mobileCountry: z.string().trim().length(2).toUpperCase().optional(),
});

function refineDocument(
  value: { documentType: (typeof DOCUMENT_TYPES)[number]; documentNumber: string },
  ctx: z.RefinementCtx,
  checksum: boolean,
) {
  const res = validateDocumentNumber(value.documentType, value.documentNumber, { checksum });
  if (!res.ok) {
    ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: `validation.document.${res.error}` });
  }
}

function refineMobile(value: { mobile: string; mobileCountry?: string | undefined }, ctx: z.RefinementCtx) {
  const res = normalizePhone(value.mobile, value.mobileCountry ?? 'SA');
  if (!res.ok) ctx.addIssue({ code: 'custom', path: ['mobile'], message: `validation.phone.${res.error}` });
}

function finalizeMobile<T extends { mobile: string; mobileCountry?: string | undefined }>(v: T) {
  const res = normalizePhone(v.mobile, v.mobileCountry ?? 'SA');
  return { ...v, mobile: res.ok ? res.e164 : v.mobile };
}

export interface SchemaOptions {
  /** Enforce the Luhn check digit on identity numbers (system setting). */
  checksum?: boolean;
}

// ───────────────────────────── Auth ─────────────────────────────

export const staffLoginSchema = z.object({
  username: requiredString(64).transform((v) => v.toLowerCase()),
  password: z.string(e('validation.required')).min(1, e('validation.required')).max(256),
  client: z.enum(CLIENT_KINDS).default('web'),
});

export const passwordSchema = z
  .string(e('validation.required'))
  .min(10, e('validation.passwordLength'))
  .max(128, e('validation.tooLong'))
  .refine((v) => /[A-Za-z؀-ۿ]/.test(v) && /\d/.test(normalizeDigits(v)), e('validation.passwordComplexity'));

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, e('validation.required')).max(256),
  newPassword: passwordSchema,
});

export const otpRequestSchema = (opts: SchemaOptions = {}) =>
  z
    .object({
      documentType: documentTypeSchema,
      documentNumber: z.string(e('validation.required')).transform(normalizeIdentifier),
      locale: z.enum(LOCALES).optional(),
    })
    .extend(mobileInputSchema.shape)
    .superRefine((v, ctx) => {
      refineDocument(v, ctx, opts.checksum ?? true);
      refineMobile(v, ctx);
    })
    .transform(finalizeMobile);

export const otpVerifySchema = z.object({
  challengeId: idSchema,
  code: z
    .string(e('validation.required'))
    .transform((v) => normalizeDigits(v).replace(/\D/g, ''))
    .refine((v) => v.length === OTP.length, e('validation.otpLength')),
  client: z.enum(CLIENT_KINDS).default('web'),
});

export const firstAdminSetupSchema = z.object({
  setupToken: z.string().min(32).max(256),
  username: requiredString(64)
    .transform((v) => v.toLowerCase())
    .refine((v) => /^[a-z0-9._-]{3,64}$/.test(v), e('validation.username')),
  fullName: fullNameSchema,
  password: passwordSchema,
});

// ───────────────────────────── Visitor profiles ─────────────────────────────

/** Visitor completes registration after OTP verification (document type, number and mobile come from the verified challenge). */
export const visitorRegistrationSchema = z.object({
  fullName: fullNameSchema,
  nationality: nationalitySchema,
  documentExpiry: documentExpiryInputSchema,
  locale: z.enum(LOCALES).optional(),
});

/** Staff create a visitor profile on the visitor's behalf. */
export const visitorCreateSchema = (opts: SchemaOptions = {}) =>
  z
    .object({
      fullName: fullNameSchema,
      documentType: documentTypeSchema,
      documentNumber: z.string(e('validation.required')).transform(normalizeIdentifier),
      documentExpiry: documentExpiryInputSchema,
      nationality: nationalitySchema,
    })
    .extend(mobileInputSchema.shape)
    .superRefine((v, ctx) => {
      refineDocument(v, ctx, opts.checksum ?? true);
      refineMobile(v, ctx);
    })
    .transform(finalizeMobile);

/** Explicit, audited profile update by staff. Each changed field is permission-checked server-side. */
export const visitorUpdateSchema = (opts: SchemaOptions = {}) =>
  z
    .object({
      expectedVersion: z.int().min(1),
      reason: requiredString(300).refine((v) => v.length >= 3, e('validation.reasonLength')),
      fullName: fullNameSchema.optional(),
      documentType: documentTypeSchema.optional(),
      documentNumber: z.string().transform(normalizeIdentifier).optional(),
      documentExpiry: documentExpiryInputSchema.optional(),
      nationality: nationalitySchema.optional(),
      mobile: z.string().trim().max(32).optional(),
      mobileCountry: z.string().trim().length(2).toUpperCase().optional(),
    })
    .superRefine((v, ctx) => {
      if (v.documentNumber !== undefined || v.documentType !== undefined) {
        if (!v.documentNumber || !v.documentType) {
          ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'validation.documentPairRequired' });
        } else {
          refineDocument({ documentType: v.documentType, documentNumber: v.documentNumber }, ctx, opts.checksum ?? true);
        }
      }
      if (v.mobile !== undefined) refineMobile({ mobile: v.mobile, mobileCountry: v.mobileCountry }, ctx);
    })
    .transform((v) => {
      if (v.mobile === undefined) return v;
      const res = normalizePhone(v.mobile, v.mobileCountry ?? 'SA');
      return { ...v, mobile: res.ok ? res.e164 : v.mobile };
    });

/** A visitor renews their own document expiry date (the only self-service profile change). */
export const visitorSelfUpdateSchema = z.object({
  expectedVersion: z.int().min(1),
  documentExpiry: documentExpiryInputSchema,
});

export const visitorLookupSchema = z.object({
  documentNumber: z
    .string(e('validation.required'))
    .transform(normalizeIdentifier)
    .refine((v) => /^\d{10}$/.test(v), e('validation.document.length')),
});

// ───────────────────────────── Visit requests ─────────────────────────────

const visitDetailsShape = {
  villaId: idSchema,
  reason: z.enum(VISIT_REASONS, e('validation.required')),
  reasonDetails: z.string().trim().max(300, e('validation.tooLong')).optional().nullable(),
  requestedEntryAt: z.iso.datetime({ offset: true, error: 'validation.invalidDate' }),
  durationMinutes: z.int(e('validation.required')).min(15, e('validation.durationMin')).max(10080, e('validation.durationMax')),
  requestedGateId: idSchema.optional().nullable(),
};

function refineReason(v: { reason?: string | undefined; reasonDetails?: string | null | undefined }, ctx: z.RefinementCtx) {
  if (v.reason === 'other' && (!v.reasonDetails || v.reasonDetails.trim().length < 3)) {
    ctx.addIssue({ code: 'custom', path: ['reasonDetails'], message: 'validation.reasonDetailsRequired' });
  }
}

export const visitRequestSchema = z
  .object({
    ...visitDetailsShape,
    /** Generated by the client on the review screen; resubmissions return the original request. */
    clientRequestId: idSchema,
  })
  .superRefine(refineReason);
export type VisitRequestInput = z.input<typeof visitRequestSchema>;

export const visitOnBehalfSchema = z
  .object({
    ...visitDetailsShape,
    clientRequestId: idSchema,
    visitorId: idSchema,
  })
  .superRefine(refineReason);

export const visitModifySchema = z
  .object({
    expectedVersion: z.int().min(1),
    villaId: idSchema.optional(),
    reason: z.enum(VISIT_REASONS).optional(),
    reasonDetails: z.string().trim().max(300).optional().nullable(),
    requestedEntryAt: z.iso.datetime({ offset: true, error: 'validation.invalidDate' }).optional(),
    durationMinutes: z.int().min(15).max(10080).optional(),
  })
  .superRefine(refineReason);

export const rejectSchema = z.object({
  reason: requiredString(500).refine((v) => v.length >= 3, e('validation.reasonLength')),
  expectedVersion: z.int().min(1).optional(),
});

export const approveSchema = z.object({
  expectedVersion: z.int().min(1).optional(),
});

export const cancelSchema = z.object({
  reason: z.string().trim().max(500, e('validation.tooLong')).optional(),
});

// ───────────────────────────── Gate scanning ─────────────────────────────

export const scanSchema = z
  .object({
    /** Raw scanned QR content (URL or token). */
    qr: z.string().trim().min(1).max(512).optional(),
    /** Manual lookup alternative to `qr` (authorized staff only). */
    visitId: idSchema.optional(),
    gateId: idSchema,
    action: z.enum(GATE_ACTIONS),
  })
  .refine((v) => Boolean(v.qr) !== Boolean(v.visitId), { error: 'validation.qrOrVisit', path: ['qr'] });

export const scanConfirmSchema = scanSchema.and(
  z.object({
    /** Staff confirm they compared the presented ID with the record (required for entry). */
    identityConfirmed: z.boolean().optional(),
    notes: z.string().trim().max(300).optional(),
  }),
);

export const manualLookupSchema = z.object({
  query: z
    .string()
    .trim()
    .min(3, e('validation.required'))
    .max(64)
    .transform((v) => normalizeIdentifier(v).toUpperCase()),
  action: z.enum(GATE_ACTIONS),
});

// ───────────────────────────── Administration ─────────────────────────────

export const gateSchema = z.object({
  nameAr: requiredString(80),
  nameEn: requiredString(80),
  supportsEntry: z.boolean(),
  supportsExit: z.boolean(),
  isActive: z.boolean().default(true),
});
export const gateUpdateSchema = gateSchema.partial().extend({ regenerateCode: z.boolean().optional() });

export const villaSchema = z.object({
  number: requiredString(20)
    .transform((v) => normalizeDigits(v).toUpperCase())
    .refine((v) => /^[A-Z0-9؀-ۿ\-/ ]{1,20}$/.test(v), e('validation.villaNumber')),
  label: z.string().trim().max(80).optional().nullable(),
  isActive: z.boolean().default(true),
});
export const villaUpdateSchema = villaSchema.partial();

export const staffUserCreateSchema = z.object({
  username: requiredString(64)
    .transform((v) => v.toLowerCase())
    .refine((v) => /^[a-z0-9._-]{3,64}$/.test(v), e('validation.username')),
  fullName: fullNameSchema,
  role: z.enum(STAFF_ROLES),
  phone: z.string().trim().max(32).optional().nullable(),
  /** Leave empty to generate a one-time temporary password. */
  password: passwordSchema.optional(),
});

export const staffUserUpdateSchema = z.object({
  fullName: fullNameSchema.optional(),
  role: z.enum(STAFF_ROLES).optional(),
  isActive: z.boolean().optional(),
  phone: z.string().trim().max(32).optional().nullable(),
});

export const settingsUpdateSchema = systemSettingsSchema;

/** Meta object IDs (phone number, WhatsApp Business Account) are long numeric strings. */
const metaIdSchema = z
  .string(e('validation.required'))
  .transform((v) => normalizeDigits(v).replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6,25}$/, e('validation.whatsappId')));

/** WhatsApp Cloud API connection entered by an administrator. An empty token keeps the stored one. */
export const whatsappConfigSchema = z.object({
  phoneNumberId: metaIdSchema,
  businessAccountId: metaIdSchema,
  accessToken: z
    .string()
    .trim()
    .max(2048, e('validation.tooLong'))
    .refine((v) => v === '' || /^[A-Za-z0-9._|-]{20,}$/.test(v), e('validation.whatsappToken'))
    .optional(),
  templateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, e('validation.whatsappTemplateName')).default('otp_code'),
  templateLanguage: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, e('validation.invalid')).default('ar'),
});
export type WhatsAppConfigInput = z.input<typeof whatsappConfigSchema>;

export const whatsappEnableSchema = z.object({ enabled: z.boolean() });

export const whatsappTestSchema = mobileInputSchema
  .superRefine((v, ctx) => refineMobile(v, ctx))
  .transform(finalizeMobile);

export const localeUpdateSchema = z.object({ locale: z.enum(LOCALES) });

export const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(255),
  platform: z.enum(['ios', 'android', 'web']),
});

// ───────────────────────────── List queries ─────────────────────────────

const pageShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
};

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.enum(values)));

export const visitListQuerySchema = z.object({
  ...pageShape,
  status: csv(VISIT_STATUSES),
  villaId: idSchema.optional(),
  gateId: idSchema.optional(),
  nationality: z.string().trim().length(2).toUpperCase().optional(),
  from: z.string().refine(isValidYmd).optional(),
  to: z.string().refine(isValidYmd).optional(),
  q: z.string().trim().max(64).transform(normalizeDigits).optional(),
  overdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  sort: z.enum(['newest', 'oldest', 'entry_asc', 'entry_desc']).default('newest'),
});
export type VisitListQuery = z.output<typeof visitListQuerySchema>;

export const visitorListQuerySchema = z.object({
  ...pageShape,
  q: z.string().trim().max(64).transform(normalizeDigits).optional(),
  nationality: z.string().trim().length(2).toUpperCase().optional(),
});

export const auditListQuerySchema = z.object({
  ...pageShape,
  action: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(32).optional(),
  actorUserId: idSchema.optional(),
  from: z.string().refine(isValidYmd).optional(),
  to: z.string().refine(isValidYmd).optional(),
});

export const gateEventListQuerySchema = z.object({
  ...pageShape,
  gateId: idSchema.optional(),
  type: z.enum(GATE_ACTIONS).optional(),
  from: z.string().refine(isValidYmd).optional(),
  to: z.string().refine(isValidYmd).optional(),
});

export const pageQuerySchema = z.object(pageShape);

// ───────────────────────────── Error helpers ─────────────────────────────

/** Flattens Zod issues into `{ "path.to.field": "translation.key" }` (first issue per field wins). */
export function fieldErrorsFromIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!(key in out)) out[key] = issue.message.startsWith('validation.') ? issue.message : 'validation.invalid';
  }
  return out;
}
