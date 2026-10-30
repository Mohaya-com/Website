'use client';

import { ArrowLeft, Camera, CheckCircle2, ImageUp, Loader2, ScanText, Send, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  arrivalSubmitSchema,
  fieldErrorsFromIssues,
  inferDocumentType,
  zonedDateString,
  zonedTimeString,
  type ArrivalScanResultDTO,
  type ArrivalSubmitResultDTO,
  type DocumentType,
  type VisitReason,
} from '@vms/shared';
import {
  DocumentExpiryInput,
  DocumentNumberInput,
  NationalitySelect,
  PhoneInput,
  ReasonPicker,
  ScheduleInput,
  VillaNumberInput,
  emptyExpiry,
  expiryToInput,
  scheduleToEntry,
  type ExpiryValue,
  type PhoneValue,
  type ScheduleValue,
} from '@/components/inputs';
import { PublicShell } from '@/components/shell/public-shell';
import { StepIndicator } from '@/components/visit-request';
import { Banner } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Segmented, Textarea } from '@/components/ui/form';
import { Button, Card, DetailItem } from '@/components/ui/primitives';
import { api, isApiError } from '@/lib/api';
import { useFormat, usePublicConfig } from '@/lib/hooks';
import { prepareImage, type PreparedImage } from '@/lib/image';
import { useI18n } from '@/lib/i18n';
import { saveArrivalToken } from './storage';

interface Draft {
  documentType: DocumentType;
  documentNumber: string;
  fullName: string;
  nationality: string;
  expiry: ExpiryValue;
  phone: PhoneValue;
  villaNumber: string;
  reason: VisitReason | null;
  reasonDetails: string;
  schedule: ScheduleValue;
}

/** Field errors from the schema mapped to the step that shows them. */
const STEP_OF_FIELD: Record<string, number> = {
  documentType: 1,
  documentNumber: 1,
  fullName: 1,
  nationality: 1,
  documentExpiry: 1,
  'documentExpiry.date': 1,
  mobile: 1,
  villaNumber: 2,
  reason: 2,
  reasonDetails: 2,
  requestedEntryAt: 2,
  durationMinutes: 2,
};

function nowSchedule(tz: string, durationMinutes: number): ScheduleValue {
  const now = new Date();
  return { date: zonedDateString(now, tz), time: zonedTimeString(now, tz), durationMinutes };
}

function ArrivalFlow() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const gateCode = search.get('gate');
  const { data: config } = usePublicConfig();
  const fmt = useFormat();
  const tz = config?.timezone ?? 'Asia/Riyadh';

  const [step, setStep] = useState(0);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [scanState, setScanState] = useState<'idle' | 'reading' | 'done' | 'nothing' | 'failed'>('idle');
  const [draft, setDraft] = useState<Draft>({
    documentType: 'national_id',
    documentNumber: '',
    fullName: '',
    nationality: 'SA',
    expiry: emptyExpiry(),
    phone: { country: 'SA', number: '' },
    villaNumber: '',
    reason: null,
    reasonDetails: '',
    schedule: nowSchedule(tz, 120),
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (config) setDraft((d) => ({ ...d, schedule: nowSchedule(config.timezone, config.defaultVisitDurationMinutes) }));
  }, [config]);
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [step]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setScanState('reading');
    try {
      const prepared = await prepareImage(file);
      setImage(prepared);
      const res = await api<ArrivalScanResultDTO>('/public/arrivals/scan', { body: { idImage: { type: prepared.type, data: prepared.data } }, timeoutMs: 60_000 });
      const f = res.fields;
      const found = Object.keys(f).length > 0;
      setDraft((d) => ({
        ...d,
        ...(f.documentNumber ? { documentNumber: f.documentNumber } : {}),
        ...(f.documentType ? { documentType: f.documentType } : {}),
        ...(f.fullName ? { fullName: f.fullName } : {}),
        ...(f.nationality ? { nationality: f.nationality } : {}),
        ...(f.expiry
          ? (() => {
              const [y, m, day] = f.expiry.date.split('-');
              return { expiry: { calendar: f.expiry.calendar, year: y ?? '', month: String(Number(m)), day: String(Number(day)) } };
            })()
          : {}),
      }));
      setScanState(found ? 'done' : 'nothing');
      setStep(1);
    } catch {
      setScanState('failed');
    }
  }

  function body() {
    const entry = scheduleToEntry(draft.schedule, tz);
    return {
      documentType: draft.documentType,
      documentNumber: draft.documentNumber,
      fullName: draft.fullName,
      nationality: draft.nationality,
      documentExpiry: expiryToInput(draft.expiry),
      mobile: draft.phone.number,
      mobileCountry: draft.phone.country,
      villaNumber: draft.villaNumber,
      reason: draft.reason ?? undefined,
      reasonDetails: draft.reasonDetails.trim() || null,
      requestedEntryAt: entry?.toISOString() ?? '',
      durationMinutes: draft.schedule.durationMinutes,
      gateCode,
      locale,
      idImage: image ? { type: image.type, data: image.data } : null,
    };
  }

  /** Validates the fields of the current step (and earlier ones) before moving on. */
  function next(target: number) {
    const parsed = arrivalSubmitSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse(body());
    const errors = parsed.success ? {} : fieldErrorsFromIssues(parsed.error.issues);
    const relevant = Object.fromEntries(Object.entries(errors).filter(([k]) => (STEP_OF_FIELD[k] ?? 9) < target));
    setFields(relevant);
    if (Object.keys(relevant).length === 0) setStep(target);
  }

  async function submit() {
    const parsed = arrivalSubmitSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse(body());
    if (!parsed.success) {
      const errors = fieldErrorsFromIssues(parsed.error.issues);
      setFields(errors);
      setStep(Math.min(...Object.keys(errors).map((k) => STEP_OF_FIELD[k] ?? 1)));
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await api<ArrivalSubmitResultDTO>('/public/arrivals', { body: body(), timeoutMs: 60_000 });
      saveArrivalToken(res.statusToken);
      router.replace(`/arrive/status#${res.statusToken}`);
    } catch (err) {
      if (isApiError(err)) {
        setFields(err.fields);
        const first = Object.keys(err.fields)[0];
        if (first && STEP_OF_FIELD[first] !== undefined) setStep(STEP_OF_FIELD[first]!);
        setSubmitError(err.messageKey);
      } else setSubmitError('errors.internal_error');
    } finally {
      setBusy(false);
    }
  }

  if (config && !config.allowArrivalRegistration) {
    return (
      <Card className="p-6">
        <Banner tone="warning">{t('arrival.disabled')}</Banner>
      </Card>
    );
  }

  const labels = [t('arrival.stepId'), t('arrival.stepDetails'), t('arrival.stepVisit'), t('arrival.stepReview')];
  const entry = scheduleToEntry(draft.schedule, tz);

  return (
    <div ref={top} className="scroll-mt-24">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-navy-900">{t('arrival.title')}</h1>
        <p className="mt-1 text-muted">{t('arrival.subtitle')}</p>
      </div>
      <StepIndicator step={step} labels={labels} />
      {submitError && <Banner tone="danger" className="mb-4">{t.dynamic(submitError)}</Banner>}

      {step === 0 && (
        <Card className="space-y-5 p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700">
              <ScanText className="size-6" aria-hidden />
            </span>
            <div>
              <h2 className="font-bold text-navy-900">{t('arrival.photoTitle')}</h2>
              <p className="mt-1 text-sm text-muted">{t('arrival.photoHint')}</p>
            </div>
          </div>
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
          {scanState === 'reading' ? (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-dashed border-teal-300 bg-teal-50/50 p-8 text-teal-800" role="status">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <span className="font-semibold">{t('arrival.reading')}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button size="lg" variant="accent" icon={<Camera className="size-5" aria-hidden />} onClick={() => cameraInput.current?.click()}>
                {t('arrival.takePhoto')}
              </Button>
              <Button size="lg" variant="secondary" icon={<ImageUp className="size-5" aria-hidden />} onClick={() => fileInput.current?.click()}>
                {t('arrival.choosePhoto')}
              </Button>
            </div>
          )}
          {scanState === 'failed' && <Banner tone="warning">{t('arrival.readFailed')}</Banner>}
          <div className="border-t border-line pt-4 text-center">
            <Button variant="ghost" onClick={() => setStep(1)} icon={<UserRound className="size-4" aria-hidden />}>
              {t('arrival.skipPhoto')}
            </Button>
            <p className="mt-1 text-xs text-muted">{t('arrival.manualNote')}</p>
          </div>
          {config?.sms.available && (
            <p className="text-center text-sm">
              <Link href="/visitor" className="font-semibold text-teal-700 underline-offset-4 hover:underline">
                {t('arrival.orSignIn')}
              </Link>
            </p>
          )}
        </Card>
      )}

      {step === 1 && (
        <Card className="space-y-5 p-5">
          {image && (
            <div className="flex items-center gap-3 rounded-xl border border-line p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.previewUrl} alt={t('arrival.imageAttached')} className="h-16 w-24 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="size-4" aria-hidden />
                  {t('arrival.imageAttached')}
                </p>
                <button type="button" className="text-sm font-semibold text-teal-700 underline-offset-4 hover:underline" onClick={() => setStep(0)}>
                  {t('arrival.retakePhoto')}
                </button>
              </div>
            </div>
          )}
          {scanState === 'done' && <Banner tone="info">{t('arrival.readDone')}</Banner>}
          {scanState === 'nothing' && <Banner tone="warning">{t('arrival.readNothing')}</Banner>}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label={t('fields.documentType')} required>
              {() => (
                <Segmented
                  label={t('fields.documentType')}
                  size="lg"
                  value={draft.documentType}
                  onChange={(v) => setDraft((d) => ({ ...d, documentType: v, nationality: v === 'national_id' ? 'SA' : d.nationality === 'SA' ? '' : d.nationality }))}
                  options={[
                    { value: 'national_id', label: t('documentTypes.national_id') },
                    { value: 'iqama', label: t('documentTypes.iqama') },
                  ]}
                />
              )}
            </Field>
            <DocumentNumberInput
              value={draft.documentNumber}
              onChange={(v) => {
                const type = inferDocumentType(v);
                setDraft((d) => ({ ...d, documentNumber: v, ...(type ? { documentType: type, nationality: type === 'national_id' ? 'SA' : d.nationality === 'SA' ? '' : d.nationality } : {}) }));
              }}
              error={fields.documentNumber}
            />
          </div>
          <Field label={t('fields.fullName')} required error={fields.fullName} hint={t('fields.fullNameHint')}>
            {(a) => <Input {...a} autoComplete="name" value={draft.fullName} onChange={(e) => set('fullName', e.target.value)} />}
          </Field>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <NationalitySelect value={draft.nationality} onChange={(v) => set('nationality', v)} error={fields.nationality} />
            <PhoneInput value={draft.phone} onChange={(v) => set('phone', v)} error={fields.mobile} />
          </div>
          <DocumentExpiryInput value={draft.expiry} onChange={(v) => set('expiry', v)} error={fields['documentExpiry.date'] ?? fields.documentExpiry} />
          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="secondary" onClick={() => setStep(0)}>
              {t('common.back')}
            </Button>
            <Button size="lg" onClick={() => next(2)} icon={<ArrowLeft className="size-5 ltr:rotate-180" aria-hidden />}>
              {t('common.next')}
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="space-y-6 p-5">
          <VillaNumberInput value={draft.villaNumber} onChange={(v) => set('villaNumber', v)} error={fields.villaNumber} />
          <ReasonPicker value={draft.reason} onChange={(v) => set('reason', v)} error={fields.reason} />
          {draft.reason === 'other' && (
            <Field label={t('fields.reasonDetails')} required error={fields.reasonDetails}>
              {(a) => <Textarea {...a} maxLength={300} placeholder={t('request.reasonOtherPlaceholder')} value={draft.reasonDetails} onChange={(e) => set('reasonDetails', e.target.value)} />}
            </Field>
          )}
          <ScheduleInput
            value={draft.schedule}
            onChange={(v) => set('schedule', v)}
            maxDurationMinutes={config?.maxVisitDurationMinutes ?? 720}
            errors={{ entry: fields.requestedEntryAt, duration: fields.durationMinutes }}
          />
          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="secondary" onClick={() => setStep(1)}>
              {t('common.back')}
            </Button>
            <Button size="lg" onClick={() => next(3)} icon={<ArrowLeft className="size-5 ltr:rotate-180" aria-hidden />}>
              {t('common.next')}
            </Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="space-y-5 p-5">
          <Banner tone="info">{t('arrival.checkFields')}</Banner>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailItem label={t('fields.documentType')} value={t(`documentTypes.${draft.documentType}`)} />
            <DetailItem label={t('fields.documentNumber')} value={draft.documentNumber} mono />
            <DetailItem label={t('fields.fullName')} value={draft.fullName} />
            <DetailItem label={t('fields.mobile')} value={draft.phone.number} mono />
            <DetailItem label={t('fields.villa')} value={draft.villaNumber} mono />
            <DetailItem label={t('fields.reason')} value={draft.reason ? (draft.reason === 'other' ? `${t('reasons.other')}: ${draft.reasonDetails}` : t(`reasons.${draft.reason}`)) : '—'} />
            <DetailItem label={t('fields.entryAt')} value={entry ? fmt.dateTime(entry) : '—'} />
            <DetailItem label={t('fields.duration')} value={fmt.duration(draft.schedule.durationMinutes)} />
          </dl>
          {image && (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="size-4" aria-hidden />
              {t('arrival.imageAttached')}
            </p>
          )}
          <Checkbox checked={consent} onChange={setConsent} label={t('arrival.consent')} />
          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="secondary" onClick={() => setStep(2)}>
              {t('common.back')}
            </Button>
            <Button size="lg" variant="accent" disabled={!consent} loading={busy} onClick={() => void submit()} icon={<Send className="size-5 rtl:-scale-x-100" aria-hidden />}>
              {t('arrival.submit')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function ArrivalPage() {
  return (
    <PublicShell>
      <Suspense>
        <ArrivalFlow />
      </Suspense>
    </PublicShell>
  );
}
