import { z } from 'zod';
import { DEFAULT_TIMEZONE } from './constants';

export const systemSettingsSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    compoundNameAr: z.string().trim().min(2).max(120),
    compoundNameEn: z.string().trim().min(2).max(120),
    /** Default duration preselected on the request form. */
    defaultVisitDurationMinutes: z.int().min(15).max(10080),
    /** Maximum duration a visit may be requested for. */
    maxVisitDurationMinutes: z.int().min(15).max(10080),
    /** Entry is allowed this many minutes before the requested entry time. */
    entryWindowEarlyMinutes: z.int().min(0).max(720),
    /** Entry is allowed until this many minutes after the requested entry time (never after the expected exit). */
    entryWindowLateMinutes: z.int().min(0).max(1440),
    /** How far in advance a visit may be requested. */
    maxAdvanceBookingDays: z.int().min(1).max(365),
    /** Visitors are flagged overdue when still inside this many minutes after the expected exit. */
    overdueGraceMinutes: z.int().min(0).max(240),
    /** Enforce the Luhn check digit on national ID / Iqama numbers. */
    identityChecksumValidation: z.boolean(),
    /** Allow visitors to register themselves through OTP verification. */
    allowVisitorSelfRegistration: z.boolean(),
  })
  .refine((s) => s.defaultVisitDurationMinutes <= s.maxVisitDurationMinutes, {
    path: ['defaultVisitDurationMinutes'],
    error: 'validation.defaultExceedsMax',
  });

export type SystemSettings = z.infer<typeof systemSettingsSchema>;

export const DEFAULT_SETTINGS: SystemSettings = {
  timezone: DEFAULT_TIMEZONE,
  compoundNameAr: 'المجمع السكني',
  compoundNameEn: 'Residential Compound',
  defaultVisitDurationMinutes: 120,
  maxVisitDurationMinutes: 720,
  entryWindowEarlyMinutes: 60,
  entryWindowLateMinutes: 120,
  maxAdvanceBookingDays: 30,
  overdueGraceMinutes: 15,
  identityChecksumValidation: true,
  allowVisitorSelfRegistration: true,
};

export const MIN_VISIT_DURATION_MINUTES = 15;

/** Quick-pick durations offered on request forms (filtered by the configured maximum). */
export const DURATION_PRESETS_MINUTES = [30, 60, 120, 180, 240, 480, 720] as const;
