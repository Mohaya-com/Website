'use client';

import { Camera, CheckCircle2, ChevronDown, ImageUp, Loader2, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { arrivalSubmitSchema, fieldErrorsFromIssues, type ArrivalScanResultDTO, type ArrivalSubmitResultDTO, type VisitReason } from '@vms/shared';
import { DocumentNumberInput, DurationPicker, NationalitySelect, PhoneInput, ReasonPicker, VillaNumberInput, type PhoneValue } from '@/components/inputs';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { Button, Card } from '@/components/ui/primitives';
import { api, isApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks';
import { prepareIdPhoto, type PreparedImage } from '@/lib/image';
import { useI18n } from '@/lib/i18n';
import { saveArrivalToken } from './storage';

/** Order of the fields on the page, to focus the first one with an error. */
const FIELD_ORDER = ['documentNumber', 'mobile', 'villaNumber', 'reason', 'reasonDetails', 'durationMinutes', 'fullName', 'nationality', 'idImage'];

/**
 * Registration at arrival on a single page. Required: identity number, mobile and villa. The ID photo,
 * name and nationality are optional; an administrator verifies everything before a pass is issued.
 */
function ArrivalForm() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const gateCode = search.get('gate');
  const { data: config } = usePublicConfig();

  const [image, setImage] = useState<PreparedImage | null>(null);
  const [reading, setReading] = useState(false);
  const [readResult, setReadResult] = useState<'number' | 'none' | 'failed' | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [phone, setPhone] = useState<PhoneValue>({ country: 'SA', number: '' });
  const [villaNumber, setVillaNumber] = useState('');
  const [reason, setReason] = useState<VisitReason | null>(null);
  const [reasonDetails, setReasonDetails] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [fullName, setFullName] = useState('');
  const [nationality, setNationality] = useState('');
  const [showOptional, setShowOptional] = useState(false);
  const [consent, setConsent] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (config) setDurationMinutes(config.defaultVisitDurationMinutes);
  }, [config]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setReadResult(null);
    try {
      const prepared = await prepareIdPhoto(file);
      setImage(prepared);
      try {
        const res = await api<ArrivalScanResultDTO>('/public/arrivals/scan', { body: { idImage: prepared.reading }, timeoutMs: 60_000 });
        const f = res.fields;
        if (f.documentNumber) setDocumentNumber(f.documentNumber);
        if (f.fullName && !fullName) {
          setFullName(f.fullName);
          setShowOptional(true);
        }
        if (f.nationality && !nationality) setNationality(f.nationality);
        setReadResult(f.documentNumber ? 'number' : 'none');
      } catch {
        // Reading is a convenience only: the photo is still attached for the administrator.
        setReadResult('none');
      }
    } catch {
      setReadResult('failed');
    } finally {
      setReading(false);
    }
  }

  function body() {
    return {
      documentNumber,
      mobile: phone.number,
      mobileCountry: phone.country,
      villaNumber,
      reason: reason ?? undefined,
      reasonDetails: reasonDetails.trim() || null,
      durationMinutes,
      fullName: fullName.trim() || undefined,
      nationality: nationality || undefined,
      gateCode,
      locale,
      idImage: image ? { type: image.type, data: image.data } : null,
    };
  }

  function showErrors(errors: Record<string, string>) {
    setFields(errors);
    if (errors.fullName || errors.nationality) setShowOptional(true);
    const first = FIELD_ORDER.find((k) => errors[k]);
    if (first) setTimeout(() => document.querySelector('[aria-invalid="true"], [role="alert"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  async function submit() {
    const parsed = arrivalSubmitSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse(body());
    if (!parsed.success) return showErrors(fieldErrorsFromIssues(parsed.error.issues));
    setFields({});
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await api<ArrivalSubmitResultDTO>('/public/arrivals', { body: body(), timeoutMs: 60_000 });
      saveArrivalToken(res.statusToken);
      router.replace(`/arrive/status#${res.statusToken}`);
    } catch (err) {
      if (isApiError(err)) {
        showErrors(err.fields);
        if (!Object.keys(err.fields).length) setSubmitError(err.messageKey);
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

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-navy-900">{t('arrival.title')}</h1>
        <p className="mt-1 text-muted">{t('arrival.subtitle')}</p>
      </div>
      {submitError && (
        <Banner tone="danger" className="mb-4">
          {t.dynamic(submitError)}
        </Banner>
      )}
      <form
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Card className="space-y-6 p-5">
          {/* ID photo (optional) */}
          <section aria-labelledby="photo-title" className="space-y-3">
            <div>
              <h2 id="photo-title" className="font-bold text-navy-900">
                {t('arrival.photoTitle')} <span className="text-sm font-normal text-muted">({t('common.optional')})</span>
              </h2>
              <p className="mt-0.5 text-sm text-muted">{t('arrival.photoHint')}</p>
            </div>
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
            {image ? (
              <div className="flex items-center gap-3 rounded-xl border border-line p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.previewUrl} alt={t('arrival.imageAttached')} className="h-16 w-24 shrink-0 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  {reading ? (
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-800" role="status">
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      {t('arrival.reading')}
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                      <CheckCircle2 className="size-4" aria-hidden />
                      {t('arrival.imageAttached')}
                    </p>
                  )}
                  <button type="button" className="text-sm font-semibold text-teal-700 underline-offset-4 hover:underline" onClick={() => cameraInput.current?.click()}>
                    {t('arrival.retakePhoto')}
                  </button>
                </div>
                <button
                  type="button"
                  className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-navy-50"
                  aria-label={t('common.remove')}
                  onClick={() => {
                    setImage(null);
                    setReadResult(null);
                  }}
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
            ) : reading ? (
              <div className="flex items-center justify-center gap-3 rounded-2xl border border-dashed border-teal-300 bg-teal-50/50 p-5 text-teal-800" role="status">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                <span className="font-semibold">{t('arrival.reading')}</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" icon={<Camera className="size-5" aria-hidden />} onClick={() => cameraInput.current?.click()}>
                  {t('arrival.takePhoto')}
                </Button>
                <Button variant="secondary" icon={<ImageUp className="size-5" aria-hidden />} onClick={() => fileInput.current?.click()}>
                  {t('arrival.choosePhoto')}
                </Button>
              </div>
            )}
            {readResult === 'number' && <Banner tone="info">{t('arrival.readNumber')}</Banner>}
            {readResult === 'none' && <p className="text-sm text-muted">{t('arrival.readNone')}</p>}
            {readResult === 'failed' && <Banner tone="warning">{t('arrival.readFailed')}</Banner>}
          </section>

          <div className="border-t border-line" />

          <DocumentNumberInput label={t('arrival.idNumber')} value={documentNumber} onChange={setDocumentNumber} error={fields.documentNumber} />
          <PhoneInput value={phone} onChange={setPhone} error={fields.mobile} hint={t('arrival.mobileHint')} />
          <VillaNumberInput value={villaNumber} onChange={setVillaNumber} error={fields.villaNumber} />
          <ReasonPicker value={reason} onChange={setReason} error={fields.reason} />
          {reason === 'other' && (
            <Field label={t('fields.reasonDetails')} required error={fields.reasonDetails}>
              {(a) => <Textarea {...a} maxLength={300} placeholder={t('request.reasonOtherPlaceholder')} value={reasonDetails} onChange={(e) => setReasonDetails(e.target.value)} />}
            </Field>
          )}
          <DurationPicker value={durationMinutes} onChange={setDurationMinutes} maxDurationMinutes={config?.maxVisitDurationMinutes ?? 720} error={fields.durationMinutes ?? fields.requestedEntryAt} />

          {/* Optional details */}
          <div className="rounded-xl border border-line">
            <button
              type="button"
              aria-expanded={showOptional}
              onClick={() => setShowOptional((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start font-semibold text-navy-900"
            >
              <span>
                {t('arrival.optionalDetails')} <span className="text-sm font-normal text-muted">({t('common.optional')})</span>
              </span>
              <ChevronDown className={`size-5 transition-transform ${showOptional ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {showOptional && (
              <div className="space-y-5 border-t border-line p-4">
                <Field label={t('fields.fullName')} optional error={fields.fullName} hint={t('fields.fullNameHint')}>
                  {(a) => <Input {...a} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />}
                </Field>
                <NationalitySelect value={nationality} onChange={setNationality} error={fields.nationality} optional />
              </div>
            )}
          </div>

          <Checkbox checked={consent} onChange={setConsent} label={t('arrival.consent')} />
          <Button type="submit" size="lg" variant="accent" block disabled={!consent || reading} loading={busy} icon={<Send className="size-5 rtl:-scale-x-100" aria-hidden />}>
            {t('arrival.submit')}
          </Button>
        </Card>
      </form>
      {config?.sms.available && (
        <p className="mt-4 text-center text-sm">
          <Link href="/visitor" className="font-semibold text-teal-700 underline-offset-4 hover:underline">
            {t('arrival.orSignIn')}
          </Link>
        </p>
      )}
    </div>
  );
}

export default function ArrivalPage() {
  return (
    <PublicShell>
      <Suspense>
        <ArrivalForm />
      </Suspense>
    </PublicShell>
  );
}
