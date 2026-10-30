'use client';

import { BriefcaseBusiness, CalendarDays, Ellipsis, Package, Users, Wrench } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DURATION_PRESETS_MINUTES,
  MIN_VISIT_DURATION_MINUTES,
  VISIT_REASONS,
  addDaysToYmd,
  addMinutes,
  computeExpectedExit,
  formatHijri,
  gregorianToHijri,
  hijriToGregorian,
  isHijriSupported,
  isValidYmd,
  normalizeDigits,
  sortedCountries,
  zonedDateString,
  zonedDateTimeToUtc,
  zonedTimeString,
  type CalendarKind,
  type VillaDTO,
  type VisitReason,
} from '@vms/shared';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { ChoiceCards, Field, Input, Segmented, Select } from './ui/form';
import { cn } from './ui/primitives';

// ───────────────────────────── Identity number ─────────────────────────────

export function DocumentNumberInput({ value, onChange, error, label, autoFocus, onEnter }: { value: string; onChange: (v: string) => void; error?: string | null; label?: string; autoFocus?: boolean; onEnter?: () => void }) {
  const { t } = useI18n();
  return (
    <Field label={label ?? t('fields.documentNumber')} required error={error} hint={t('fields.documentNumberHint')}>
      {(a) => (
        <Input
          {...a}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={14}
          autoFocus={autoFocus}
          placeholder="1XXXXXXXXX"
          className="text-lg font-semibold tracking-[0.12em] ltr-nums"
          value={value}
          onChange={(e) => onChange(normalizeDigits(e.target.value).replace(/[^\d ]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
        />
      )}
    </Field>
  );
}

// ───────────────────────────── Phone ─────────────────────────────

export interface PhoneValue {
  country: string;
  number: string;
}

export function PhoneInput({ value, onChange, error, hint }: { value: PhoneValue; onChange: (v: PhoneValue) => void; error?: string | null; hint?: string }) {
  const { t, locale } = useI18n();
  const countries = useMemo(() => sortedCountries(locale), [locale]);
  return (
    <Field label={t('fields.mobile')} required error={error} hint={hint ?? t('fields.mobileHint')}>
      {(a) => (
        <div className="flex gap-2" dir="ltr">
          <Select aria-label={t('fields.countryCode')} className="w-32 shrink-0 text-sm" value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                +{c.dial} {c.code}
              </option>
            ))}
          </Select>
          <Input
            {...a}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder={value.country === 'SA' ? '05X XXX XXXX' : ''}
            className="ltr-nums min-w-0 flex-1 text-lg font-semibold tracking-wide"
            value={value.number}
            onChange={(e) => onChange({ ...value, number: normalizeDigits(e.target.value).replace(/[^\d+ ]/g, '') })}
          />
        </div>
      )}
    </Field>
  );
}

// ───────────────────────────── Nationality ─────────────────────────────

export function NationalitySelect({ value, onChange, error, optional }: { value: string; onChange: (v: string) => void; error?: string | null; optional?: boolean }) {
  const { t, locale } = useI18n();
  const countries = useMemo(() => sortedCountries(locale), [locale]);
  return (
    <Field label={t('fields.nationality')} required={!optional} optional={optional} error={error}>
      {(a) => (
        <Select {...a} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('common.select')}</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c[locale]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

// ───────────────────────────── Document expiry (Gregorian / Hijri) ─────────────────────────────

export interface ExpiryValue {
  calendar: CalendarKind;
  day: string;
  month: string;
  year: string;
}

export const emptyExpiry = (): ExpiryValue => ({ calendar: 'gregorian', day: '', month: '', year: '' });

export function expiryToInput(v: ExpiryValue): { calendar: CalendarKind; date: string } {
  return { calendar: v.calendar, date: `${v.year}-${v.month.padStart(2, '0')}-${v.day.padStart(2, '0')}` };
}

export function expiryFromStored(gregorian: string, calendar: CalendarKind, original: string): ExpiryValue {
  const [y, m, d] = (calendar === 'hijri' ? original : gregorian).split('-');
  return { calendar, year: y ?? '', month: String(Number(m ?? '')), day: String(Number(d ?? '')) };
}

/** Resolves the Gregorian date for preview (the server re-computes it authoritatively). */
export function expiryGregorian(v: ExpiryValue): string | null {
  const y = Number(v.year);
  const m = Number(v.month);
  const d = Number(v.day);
  if (!y || !m || !d) return null;
  if (v.calendar === 'hijri') return hijriToGregorian({ year: y, month: m, day: d });
  const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidYmd(ymd) ? ymd : null;
}

export function DocumentExpiryInput({ value, onChange, error }: { value: ExpiryValue; onChange: (v: ExpiryValue) => void; error?: string | null }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const gregorian = expiryGregorian(value);
  const today = zonedDateString(new Date(), fmt.tz);
  const expired = gregorian !== null && gregorian < today;
  const hijriPreview = value.calendar === 'gregorian' && gregorian ? formatHijri(gregorianToHijri(gregorian)) : null;
  const setPart = (part: 'day' | 'month' | 'year', raw: string) => onChange({ ...value, [part]: normalizeDigits(raw).replace(/\D/g, '').slice(0, part === 'year' ? 4 : 2) });
  return (
    <Field label={t('fields.documentExpiry')} required error={error} hint={t('calendars.storedAsGregorian')}>
      {(a) => (
        <div className="space-y-2.5">
          <Segmented
            label={t('common.calendarLabel')}
            value={value.calendar}
            onChange={(calendar) => onChange({ ...value, calendar })}
            options={[
              { value: 'gregorian', label: t('calendars.gregorian') },
              { value: 'hijri', label: t('calendars.hijri') },
            ]}
          />
          <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2">
            {(['day', 'month', 'year'] as const).map((part) => (
              <label key={part} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">{t(`common.${part}`)}</span>
                <Input
                  {...(part === 'day' ? a : { 'aria-invalid': a['aria-invalid'] })}
                  dir="ltr"
                  inputMode="numeric"
                  placeholder={part === 'year' ? (value.calendar === 'hijri' ? '1449' : '2027') : part === 'month' ? 'MM' : 'DD'}
                  className="text-center text-lg font-semibold ltr-nums"
                  value={value[part]}
                  onChange={(e) => setPart(part, e.target.value)}
                />
              </label>
            ))}
          </div>
          {gregorian && (
            <p className={cn('flex items-center gap-1.5 text-sm', expired ? 'font-semibold text-red-700' : 'text-muted')}>
              <CalendarDays className="size-4" aria-hidden />
              {value.calendar === 'hijri' ? t('calendars.equivalent', { date: `${fmt.ymd(gregorian)} (${t('calendars.gregorianShort')})` }) : hijriPreview && t('calendars.equivalent', { date: hijriPreview })}
              {expired && ` — ${t('validation.documentExpired')}`}
            </p>
          )}
          {value.calendar === 'hijri' && !gregorian && value.year && value.month && value.day && !isHijriSupported() && <p className="text-sm text-muted">{t('calendars.conversionUnavailable')}</p>}
        </div>
      )}
    </Field>
  );
}

// ───────────────────────────── Villa ─────────────────────────────

export function useVillaOptions() {
  return useQuery({ queryKey: ['villa-options'], queryFn: () => api<{ items: VillaDTO[] }>('/villas/options'), staleTime: 5 * 60_000 });
}

/** Free-text villa number (Arabic digits accepted); suggests numbers already on file. */
export function VillaNumberInput({ value, onChange, error, large }: { value: string; onChange: (v: string) => void; error?: string | null; large?: boolean }) {
  const { t } = useI18n();
  const { data } = useVillaOptions();
  const listId = useId();
  return (
    <Field label={t('fields.villa')} required error={error} hint={t('request.villaNumberHint')}>
      {(a) => (
        <>
          <Input {...a} dir="ltr" inputMode="text" autoComplete="off" maxLength={20} list={listId} className={cn('ltr-nums font-semibold', large ? 'h-16 text-3xl tracking-wider' : 'text-lg')} value={value} onChange={(e) => onChange(normalizeDigits(e.target.value))} />
          <datalist id={listId}>{data?.items.map((v) => <option key={v.id} value={v.number} />)}</datalist>
        </>
      )}
    </Field>
  );
}

export function VillaSelect({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | null }) {
  const { t } = useI18n();
  const { data, isLoading } = useVillaOptions();
  return (
    <Field label={t('fields.villa')} required error={error}>
      {(a) => (
        <Select {...a} value={value} onChange={(e) => onChange(e.target.value)} disabled={isLoading}>
          <option value="">{isLoading ? t('common.loading') : t('request.selectVillaPlaceholder')}</option>
          {data?.items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.number}
              {v.label ? ` — ${v.label}` : ''}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

// ───────────────────────────── Reason ─────────────────────────────

const REASON_ICONS: Record<VisitReason, typeof Users> = {
  personal: Users,
  delivery: Package,
  maintenance: Wrench,
  service_provider: BriefcaseBusiness,
  other: Ellipsis,
};

export function ReasonPicker({ value, onChange, error }: { value: VisitReason | null; onChange: (v: VisitReason) => void; error?: string | null }) {
  const { t } = useI18n();
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-semibold text-ink">
        {t('fields.reason')} <span className="text-red-700" aria-hidden>*</span>
      </legend>
      <ChoiceCards
        label={t('fields.reason')}
        value={value}
        onChange={onChange}
        options={VISIT_REASONS.map((r) => {
          const Icon = REASON_ICONS[r];
          return { value: r, label: t(`reasons.${r}`), icon: <Icon className="size-5" aria-hidden /> };
        })}
      />
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.dynamic(error)}
        </p>
      )}
    </fieldset>
  );
}

// ───────────────────────────── Entry date/time and duration ─────────────────────────────

export interface ScheduleValue {
  date: string;
  time: string;
  durationMinutes: number;
}

/** Next quarter hour in compound time. */
export function defaultSchedule(tz: string, durationMinutes: number): ScheduleValue {
  const now = new Date();
  const rounded = new Date(Math.ceil(addMinutes(now, 10).getTime() / (15 * 60_000)) * 15 * 60_000);
  return { date: zonedDateString(rounded, tz), time: zonedTimeString(rounded, tz), durationMinutes };
}

export function scheduleToEntry(v: ScheduleValue, tz: string): Date | null {
  if (!isValidYmd(v.date) || !/^\d{2}:\d{2}$/.test(v.time)) return null;
  return zonedDateTimeToUtc(v.date, v.time, tz);
}

/** Visit duration: common presets plus a custom number of minutes. */
export function DurationPicker({ value, onChange, maxDurationMinutes, error }: { value: number; onChange: (minutes: number) => void; maxDurationMinutes: number; error?: string | null }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const presets = DURATION_PRESETS_MINUTES.filter((m) => m <= maxDurationMinutes);
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold text-ink">
        {t('fields.duration')} <span className="text-red-700" aria-hidden>*</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {presets.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={value === m}
            onClick={() => onChange(m)}
            className={cn('h-11 rounded-xl border px-4 text-[15px] font-semibold transition-colors', value === m ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-line-strong bg-white hover:bg-navy-50')}
          >
            {fmt.duration(m)}
          </button>
        ))}
        <label className={cn('flex h-11 items-center gap-2 rounded-xl border px-3', !presets.includes(value as (typeof presets)[number]) ? 'border-teal-500 bg-teal-50' : 'border-line-strong bg-white')}>
          <span className="text-sm font-semibold">{t('request.durationCustom')}</span>
          <input
            type="number"
            min={MIN_VISIT_DURATION_MINUTES}
            max={maxDurationMinutes}
            step={15}
            dir="ltr"
            className="w-20 bg-transparent text-[15px] font-semibold focus:outline-none"
            value={value}
            onChange={(e) => onChange(Number(normalizeDigits(e.target.value)) || 0)}
            aria-label={t('request.durationCustomHint', { max: maxDurationMinutes })}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-sm font-medium text-red-700">
          {t.dynamic(error)}
        </p>
      )}
    </fieldset>
  );
}

export function ScheduleInput({ value, onChange, maxDurationMinutes, errors }: { value: ScheduleValue; onChange: (v: ScheduleValue) => void; maxDurationMinutes: number; errors?: { entry?: string | null; duration?: string | null } }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const today = zonedDateString(new Date(), fmt.tz);
  const quickDates = [
    { ymd: today, label: t('common.today') },
    { ymd: addDaysToYmd(today, 1), label: t('common.tomorrow') },
    { ymd: addDaysToYmd(today, 2), label: t('common.dayAfterTomorrow') },
  ];
  const isQuick = quickDates.some((d) => d.ymd === value.date);
  const presets = DURATION_PRESETS_MINUTES.filter((m) => m <= maxDurationMinutes);
  const entry = scheduleToEntry(value, fmt.tz);
  const exit = entry ? computeExpectedExit(entry, value.durationMinutes) : null;

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-ink">
          {t('fields.entryDate')} <span className="text-red-700" aria-hidden>*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {quickDates.map((d) => (
            <button
              key={d.ymd}
              type="button"
              aria-pressed={value.date === d.ymd}
              onClick={() => onChange({ ...value, date: d.ymd })}
              className={cn('h-11 rounded-xl border px-4 text-[15px] font-semibold transition-colors', value.date === d.ymd ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-line-strong bg-white hover:bg-navy-50')}
            >
              {d.label}
              <span className="ms-1.5 text-xs font-normal text-muted">{fmt.weekday(zonedDateTimeToUtc(d.ymd, '12:00', fmt.tz))}</span>
            </button>
          ))}
          <label className={cn('flex h-11 items-center gap-2 rounded-xl border px-3', !isQuick ? 'border-teal-500 bg-teal-50' : 'border-line-strong bg-white')}>
            <span className="text-sm font-semibold">{t('common.pickDate')}</span>
            <input type="date" className="bg-transparent text-[15px] focus:outline-none" value={value.date} min={today} onChange={(e) => onChange({ ...value, date: e.target.value })} aria-label={t('fields.entryDate')} />
          </label>
        </div>
      </fieldset>

      <Field label={t('fields.entryTime')} required error={errors?.entry} hint={t('request.timezoneNote', { tz: fmt.tz })}>
        {(a) => <Input {...a} type="time" step={300} dir="ltr" className="max-w-48 text-lg font-semibold" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} />}
      </Field>

      <DurationPicker value={value.durationMinutes} onChange={(durationMinutes) => onChange({ ...value, durationMinutes })} maxDurationMinutes={maxDurationMinutes} error={errors?.duration} />

      <div className="flex items-center justify-between gap-3 rounded-xl bg-navy-50 px-4 py-3">
        <div>
          <p className="text-xs font-medium text-navy-700">{t('fields.expectedExit')}</p>
          <p className="text-[15px] font-bold text-navy-900">{exit ? fmt.dateTime(exit) : '—'}</p>
        </div>
        <p className="text-xs text-navy-700">{t('request.expectedExitAuto')}</p>
      </div>
    </div>
  );
}
