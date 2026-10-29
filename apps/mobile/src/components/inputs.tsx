import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { BriefcaseBusiness, CalendarDays, Check, ChevronDown, Clock, Ellipsis, Package, Search, Users, Wrench, X, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Modal, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  isValidYmd,
  normalizeDigits,
  sortedCountries,
  zonedDateString,
  zonedDateTimeToUtc,
  zonedTimeString,
  type CalendarKind,
  type VisitReason,
} from '@vms/shared';
import { useFormat, useVillaOptions } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors, ltr, radius, space, TOUCH } from '@/lib/theme';
import { AppText, Button, Chip, Field, Input, Row, Segmented, styles as ui } from './ui';

// ───────────────────────────── Searchable select sheet ─────────────────────────────

export interface Option {
  value: string;
  label: string;
  sub?: string;
}

export function SelectSheet({ visible, onClose, title, options, value, onSelect, searchable = true }: { visible: boolean; onClose: () => void; title: string; options: Option[]; value: string; onSelect: (v: string) => void; searchable?: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = normalizeDigits(q.trim()).toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.sub?.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)) : options;
  }, [q, options]);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Row style={{ padding: space.lg, justifyContent: 'space-between' }}>
          <AppText variant="heading">{title}</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={10} style={ui.iconButton}>
            <X size={22} color={colors.ink} />
          </Pressable>
        </Row>
        {searchable ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            <Row style={[ui.input, { paddingHorizontal: space.md }]}>
              <Search size={18} color={colors.muted} />
              <Input value={q} onChangeText={setQ} placeholder={t('common.search')} accessibilityLabel={t('common.search')} style={{ flex: 1, borderWidth: 0, minHeight: 44, paddingHorizontal: 0 }} autoFocus={Platform.OS !== 'web'} />
            </Row>
          </View>
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.value}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }}
          initialNumToRender={30}
          renderItem={({ item }) => {
            const selected = item.value === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  onSelect(item.value);
                  setQ('');
                  onClose();
                }}
                style={({ pressed }) => ({ minHeight: TOUCH + 4, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: selected ? colors.teal50 : pressed ? colors.navy50 : 'transparent' })}
              >
                <View style={{ flex: 1 }}>
                  <AppText weight={selected ? 'bold' : 'semibold'}>{item.label}</AppText>
                  {item.sub ? <AppText variant="small">{item.sub}</AppText> : null}
                </View>
                {selected ? <Check size={20} color={colors.teal700} /> : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={<AppText variant="caption" align="center" style={{ padding: space.xl }}>{t('common.noResults')}</AppText>}
        />
      </SafeAreaView>
    </Modal>
  );
}

function SelectButton({ label, placeholder, onPress, invalid, icon }: { label: string | null; placeholder: string; onPress: () => void; invalid?: boolean; icon?: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[ui.input, { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderColor: invalid ? colors.red700 : colors.lineStrong }]}>
      {icon}
      <AppText weight="semibold" style={{ flex: 1, color: label ? colors.ink : '#94A3B8' }}>
        {label ?? placeholder}
      </AppText>
      <ChevronDown size={18} color={colors.muted} />
    </Pressable>
  );
}

// ───────────────────────────── Identity and contact ─────────────────────────────

export function DocumentNumberInput({ value, onChange, error, onSubmit }: { value: string; onChange: (v: string) => void; error?: string | null; onSubmit?: () => void }) {
  const { t } = useI18n();
  return (
    <Field label={t('fields.documentNumber')} required error={error} hint={t('fields.documentNumberHint')}>
      <Input
        value={value}
        onChangeText={(v) => onChange(normalizeDigits(v).replace(/[^\d]/g, '').slice(0, 10))}
        keyboardType="number-pad"
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        maxLength={10}
        placeholder="1XXXXXXXXX"
        accessibilityLabel={t('fields.documentNumber')}
        invalid={Boolean(error)}
        ltrInput
        style={{ fontSize: 20, letterSpacing: 2 }}
      />
    </Field>
  );
}

export interface PhoneValue {
  country: string;
  number: string;
}

export function PhoneInput({ value, onChange, error }: { value: PhoneValue; onChange: (v: PhoneValue) => void; error?: string | null }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const countries = useMemo(() => sortedCountries(locale), [locale]);
  const current = countries.find((c) => c.code === value.country);
  return (
    <Field label={t('fields.mobile')} required error={error} hint={t('fields.mobileHint')}>
      <View style={{ flexDirection: 'row', gap: space.sm, direction: 'ltr' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('fields.countryCode')} onPress={() => setOpen(true)} style={[ui.input, { flexDirection: 'row', alignItems: 'center', gap: 4, width: 104, justifyContent: 'center' }]}>
          <AppText weight="bold">{`+${current?.dial ?? ''}`}</AppText>
          <ChevronDown size={16} color={colors.muted} />
        </Pressable>
        <Input
          value={value.number}
          onChangeText={(v) => onChange({ ...value, number: normalizeDigits(v).replace(/[^\d+ ]/g, '') })}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          placeholder={value.country === 'SA' ? '05X XXX XXXX' : ''}
          accessibilityLabel={t('fields.mobile')}
          invalid={Boolean(error)}
          ltrInput
          style={{ flex: 1, minWidth: 0, fontSize: 18 }}
        />
      </View>
      <SelectSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('fields.countryCode')}
        value={value.country}
        onSelect={(country) => onChange({ ...value, country })}
        options={countries.map((c) => ({ value: c.code, label: c[locale], sub: `+${c.dial}` }))}
      />
    </Field>
  );
}

export function NationalityPicker({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | null }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const countries = useMemo(() => sortedCountries(locale), [locale]);
  const selected = countries.find((c) => c.code === value);
  return (
    <Field label={t('fields.nationality')} required error={error}>
      <SelectButton label={selected ? selected[locale] : null} placeholder={t('common.select')} onPress={() => setOpen(true)} invalid={Boolean(error)} />
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={t('fields.nationality')} value={value} onSelect={onChange} options={countries.map((c) => ({ value: c.code, label: c[locale] }))} />
    </Field>
  );
}

export interface ExpiryValue {
  calendar: CalendarKind;
  day: string;
  month: string;
  year: string;
}

export const emptyExpiry = (): ExpiryValue => ({ calendar: 'gregorian', day: '', month: '', year: '' });
export const expiryToInput = (v: ExpiryValue) => ({ calendar: v.calendar, date: `${v.year}-${v.month.padStart(2, '0')}-${v.day.padStart(2, '0')}` });
export function expiryFromStored(gregorian: string, calendar: CalendarKind, original: string): ExpiryValue {
  const [y, m, d] = (calendar === 'hijri' ? original : gregorian).split('-');
  return { calendar, year: y ?? '', month: String(Number(m ?? '')), day: String(Number(d ?? '')) };
}
export function expiryGregorian(v: ExpiryValue): string | null {
  const y = Number(v.year);
  const m = Number(v.month);
  const d = Number(v.day);
  if (!y || !m || !d) return null;
  if (v.calendar === 'hijri') return hijriToGregorian({ year: y, month: m, day: d });
  const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidYmd(ymd) ? ymd : null;
}

/** Expiry date with an explicit calendar (Gregorian / Hijri Umm al-Qura); stored as Gregorian. */
export function ExpiryInput({ value, onChange, error }: { value: ExpiryValue; onChange: (v: ExpiryValue) => void; error?: string | null }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const g = expiryGregorian(value);
  const expired = g !== null && g < zonedDateString(new Date(), fmt.tz);
  const set = (part: 'day' | 'month' | 'year', raw: string) => onChange({ ...value, [part]: normalizeDigits(raw).replace(/\D/g, '').slice(0, part === 'year' ? 4 : 2) });
  return (
    <Field label={t('fields.documentExpiry')} required error={error} hint={t('calendars.storedAsGregorian')}>
      <Segmented
        label={t('common.calendarLabel')}
        value={value.calendar}
        onChange={(calendar) => onChange({ ...value, calendar })}
        options={[
          { value: 'gregorian', label: t('calendars.gregorian') },
          { value: 'hijri', label: t('calendars.hijri') },
        ]}
      />
      <Row gap={space.sm}>
        {(['day', 'month', 'year'] as const).map((part) => (
          <View key={part} style={{ flex: part === 'year' ? 1.4 : 1, gap: 4 }}>
            <AppText variant="small">{t(`common.${part}`)}</AppText>
            <Input
              value={value[part]}
              onChangeText={(v) => set(part, v)}
              keyboardType="number-pad"
              placeholder={part === 'year' ? (value.calendar === 'hijri' ? '1449' : '2027') : part === 'month' ? 'MM' : 'DD'}
              accessibilityLabel={`${t('fields.documentExpiry')} ${t(`common.${part}`)}`}
              invalid={Boolean(error)}
              style={{ textAlign: 'center', fontSize: 18 }}
            />
          </View>
        ))}
      </Row>
      {g ? (
        <Row gap={6}>
          <CalendarDays size={15} color={expired ? colors.red700 : colors.muted} />
          <AppText variant="caption" style={expired ? { color: colors.red700, fontFamily: 'Cairo_700Bold' } : undefined}>
            {value.calendar === 'hijri' ? t('calendars.equivalent', { date: `${fmt.ymd(g)} (${t('calendars.gregorianShort')})` }) : t('calendars.equivalent', { date: formatHijri(gregorianToHijri(g)) })}
            {expired ? ` — ${t('validation.documentExpired')}` : ''}
          </AppText>
        </Row>
      ) : null}
    </Field>
  );
}

// ───────────────────────────── Visit details ─────────────────────────────

/** Free-text villa number (Arabic digits accepted); a new number is added to the villa list by the server. */
export function VillaNumberInput({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | null }) {
  const { t } = useI18n();
  return (
    <Field label={t('fields.villa')} required error={error} hint={t('request.villaNumberHint')}>
      <Input ltrInput value={value} onChangeText={(v) => onChange(normalizeDigits(v).slice(0, 20))} autoCapitalize="characters" autoCorrect={false} maxLength={20} invalid={Boolean(error)} accessibilityLabel={t('fields.villa')} />
    </Field>
  );
}

export function VillaPicker({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const villas = useVillaOptions();
  const selected = villas.data?.items.find((v) => v.id === value);
  return (
    <Field label={t('fields.villa')} required error={error}>
      <SelectButton label={selected ? `${t('fields.villa')} ${ltr(selected.number)}` : null} placeholder={villas.isLoading ? t('common.loading') : t('request.selectVillaPlaceholder')} onPress={() => setOpen(true)} invalid={Boolean(error)} />
      <SelectSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('request.searchVilla')}
        value={value}
        onSelect={onChange}
        options={(villas.data?.items ?? []).map((v) => ({ value: v.id, label: v.number, sub: v.label ?? undefined }))}
      />
    </Field>
  );
}

const REASON_ICONS: Record<VisitReason, LucideIcon> = { personal: Users, delivery: Package, maintenance: Wrench, service_provider: BriefcaseBusiness, other: Ellipsis };

export function ReasonPicker({ value, onChange, error }: { value: VisitReason | null; onChange: (v: VisitReason) => void; error?: string | null }) {
  const { t } = useI18n();
  return (
    <Field label={t('fields.reason')} required error={error}>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {VISIT_REASONS.map((r) => {
          const Icon = REASON_ICONS[r];
          const active = value === r;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => onChange(r)}
              style={{ width: '48.5%', minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md, borderWidth: active ? 2 : 1, borderColor: active ? colors.teal500 : colors.lineStrong, backgroundColor: active ? colors.teal50 : colors.white }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.teal600 : colors.navy50 }}>
                <Icon size={18} color={active ? colors.white : colors.navy700} />
              </View>
              <AppText weight="bold" style={{ flex: 1, color: active ? colors.teal800 : colors.ink }}>
                {t(`reasons.${r}`)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

export interface ScheduleValue {
  date: string;
  time: string;
  durationMinutes: number;
}

export function defaultSchedule(tz: string, durationMinutes: number): ScheduleValue {
  const rounded = new Date(Math.ceil(addMinutes(new Date(), 10).getTime() / (15 * 60_000)) * 15 * 60_000);
  return { date: zonedDateString(rounded, tz), time: zonedTimeString(rounded, tz), durationMinutes };
}

export function scheduleToEntry(v: ScheduleValue, tz: string): Date | null {
  if (!isValidYmd(v.date) || !/^\d{2}:\d{2}$/.test(v.time)) return null;
  return zonedDateTimeToUtc(v.date, v.time, tz);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date chips + native time/date pickers. Wall-clock values are interpreted in the compound time zone. */
export function SchedulePicker({ value, onChange, maxDurationMinutes, errors }: { value: ScheduleValue; onChange: (v: ScheduleValue) => void; maxDurationMinutes: number; errors?: { entry?: string | null; duration?: string | null } }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const [iosPicker, setIosPicker] = useState<'date' | 'time' | null>(null);
  const today = zonedDateString(new Date(), fmt.tz);
  const quick = [
    { ymd: today, label: t('common.today') },
    { ymd: addDaysToYmd(today, 1), label: t('common.tomorrow') },
    { ymd: addDaysToYmd(today, 2), label: t('common.dayAfterTomorrow') },
  ];
  const presets = DURATION_PRESETS_MINUTES.filter((m) => m <= maxDurationMinutes);
  const entry = scheduleToEntry(value, fmt.tz);
  const exit = entry ? computeExpectedExit(entry, value.durationMinutes) : null;
  const [h, mi] = value.time.split(':').map(Number) as [number, number];
  const [y, mo, d] = value.date.split('-').map(Number) as [number, number, number];
  const pickerValue = new Date(y, (mo ?? 1) - 1, d ?? 1, h ?? 9, mi ?? 0);
  const [customOpen, setCustomOpen] = useState(!presets.includes(value.durationMinutes as (typeof presets)[number]));

  const apply = (mode: 'date' | 'time', date: Date) => {
    if (mode === 'date') onChange({ ...value, date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` });
    else onChange({ ...value, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` });
  };
  const openPicker = (mode: 'date' | 'time') => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: pickerValue, mode, is24Hour: false, minimumDate: mode === 'date' ? new Date() : undefined, onChange: (event, date) => event.type === 'set' && date && apply(mode, date) });
    } else setIosPicker(mode);
  };

  return (
    <View style={{ gap: space.lg }}>
      <Field label={t('fields.entryDate')} required>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {quick.map((q) => (
            <Chip key={q.ymd} label={q.label} sub={fmt.weekday(zonedDateTimeToUtc(q.ymd, '12:00', fmt.tz))} selected={value.date === q.ymd} onPress={() => onChange({ ...value, date: q.ymd })} />
          ))}
          {Platform.OS === 'web' ? (
            <Input value={value.date} onChangeText={(date) => onChange({ ...value, date })} placeholder="YYYY-MM-DD" accessibilityLabel={t('common.pickDate')} ltrInput style={{ minWidth: 140 }} />
          ) : (
            <Chip label={quick.some((q) => q.ymd === value.date) ? t('common.pickDate') : fmt.ymd(value.date)} selected={!quick.some((q) => q.ymd === value.date)} onPress={() => openPicker('date')} />
          )}
        </View>
      </Field>
      <Field label={t('fields.entryTime')} required error={errors?.entry} hint={t('request.timezoneNote', { tz: fmt.tz })}>
        {Platform.OS === 'web' ? (
          <Input value={value.time} onChangeText={(time) => onChange({ ...value, time })} placeholder="HH:MM" accessibilityLabel={t('fields.entryTime')} ltrInput style={{ maxWidth: 160 }} />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={t('fields.entryTime')} onPress={() => openPicker('time')} style={[ui.input, { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', minWidth: 170, borderColor: errors?.entry ? colors.red700 : colors.lineStrong }]}>
            <Clock size={18} color={colors.navy700} />
            <AppText weight="bold" style={{ fontSize: 18 }}>
              {entry ? fmt.time(entry) : value.time}
            </AppText>
          </Pressable>
        )}
      </Field>
      <Field label={t('fields.duration')} required error={errors?.duration}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {presets.map((m) => (
            <Chip
              key={m}
              label={fmt.duration(m)}
              selected={!customOpen && value.durationMinutes === m}
              onPress={() => {
                setCustomOpen(false);
                onChange({ ...value, durationMinutes: m });
              }}
            />
          ))}
          <Chip label={t('request.durationCustom')} selected={customOpen} onPress={() => setCustomOpen(true)} />
        </View>
        {customOpen ? (
          <Input
            value={String(value.durationMinutes || '')}
            onChangeText={(v) => onChange({ ...value, durationMinutes: Number(normalizeDigits(v).replace(/\D/g, '')) || 0 })}
            keyboardType="number-pad"
            accessibilityLabel={t('request.durationCustomHint', { max: maxDurationMinutes })}
            placeholder={t('request.durationCustomHint', { max: maxDurationMinutes })}
            style={{ maxWidth: 200 }}
          />
        ) : null}
        <AppText variant="small">{`${MIN_VISIT_DURATION_MINUTES}–${maxDurationMinutes} ${t('common.minutes')}`}</AppText>
      </Field>
      <View style={{ backgroundColor: colors.navy50, borderRadius: radius.md, padding: space.md, gap: 2 }}>
        <AppText variant="small" style={{ color: colors.navy700 }}>
          {t('fields.expectedExit')}
        </AppText>
        <AppText weight="bold" style={{ color: colors.navy900 }}>
          {exit ? fmt.dateTime(exit) : '—'}
        </AppText>
        <AppText variant="small" style={{ color: colors.navy700 }}>
          {t('request.expectedExitAuto')}
        </AppText>
      </View>
      {Platform.OS === 'ios' && iosPicker ? (
        <Modal transparent animationType="fade" onRequestClose={() => setIosPicker(null)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(6,18,36,0.45)' }} onPress={() => setIosPicker(null)} />
          <View style={{ backgroundColor: colors.white, padding: space.lg, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <DateTimePicker value={pickerValue} mode={iosPicker} display="spinner" minimumDate={iosPicker === 'date' ? new Date() : undefined} onChange={(_, date) => date && apply(iosPicker, date)} />
            <Button title={t('common.done')} onPress={() => setIosPicker(null)} />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
