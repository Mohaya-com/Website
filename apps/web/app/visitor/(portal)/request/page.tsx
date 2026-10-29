'use client';

import { ArrowLeft, ArrowRight, RotateCcw, Send, ShieldAlert } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { zonedDateString, zonedTimeString, type PublicGateDTO, type VisitDTO } from '@vms/shared';
import { defaultSchedule } from '@/components/inputs';
import { Banner, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Button, ButtonLink, Card, DetailItem, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import {
  StepIndicator,
  SubmittedConfirmation,
  VisitDetailsForm,
  VisitReview,
  draftToBody,
  serverErrorsToDraft,
  validateDraft,
  type DraftErrors,
  type VisitDraft,
} from '@/components/visit-request';
import { api, isApiError } from '@/lib/api';
import { useDraft, useOnline, usePublicConfig, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

function RequestWizard() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const online = useOnline();
  const { data: config } = usePublicConfig();
  const { data: session } = useSession();
  const editId = search.get('edit');
  const gateCode = search.get('gate');
  const tz = config?.timezone ?? 'Asia/Riyadh';

  const initial: VisitDraft = { villaId: '', reason: null, reasonDetails: '', schedule: defaultSchedule(tz, config?.defaultVisitDurationMinutes ?? 120), requestedGateId: null };
  const [draft, setDraft, clearDraft, restored] = useDraft<VisitDraft>(editId ? `edit:${editId}` : 'visit-request', initial);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientRequestId, setClientRequestId] = useState<string>('');
  const [submitted, setSubmitted] = useState<VisitDTO | null>(null);

  const gate = useQuery({ queryKey: ['public-gate', gateCode], queryFn: () => api<PublicGateDTO>(`/public/gates/${gateCode}`), enabled: Boolean(gateCode), retry: false });
  useEffect(() => {
    if (gate.data && draft.requestedGateId !== gate.data.id) setDraft((d) => ({ ...d, requestedGateId: gate.data.id }));
  }, [gate.data, draft.requestedGateId, setDraft]);

  const editing = useQuery({ queryKey: ['my-visit', editId], queryFn: () => api<VisitDTO>(`/me/visits/${editId}`), enabled: Boolean(editId) });
  useEffect(() => {
    const v = editing.data;
    if (!v || restored) return;
    setDraft({
      villaId: v.villa.id,
      reason: v.reason,
      reasonDetails: v.reasonDetails ?? '',
      schedule: { date: zonedDateString(new Date(v.requestedEntryAt), tz), time: zonedTimeString(new Date(v.requestedEntryAt), tz), durationMinutes: v.durationMinutes },
      requestedGateId: v.requestedGate?.id ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.data]);

  function goReview() {
    const errs = validateDraft(draft, config, session?.visitor?.documentExpiryDate);
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.querySelector('[aria-invalid="true"], [role="alert"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // New idempotency key per reviewed request; resubmitting the same review never duplicates it.
    setClientRequestId(crypto.randomUUID());
    setSubmitError(null);
    setStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const body = draftToBody(draft, tz, clientRequestId);
      if (editId && editing.data) {
        const res = await api<{ visit: VisitDTO; replaced: boolean }>(`/me/visits/${editId}`, {
          method: 'PATCH',
          body: { expectedVersion: editing.data.version, villaId: body.villaId, reason: body.reason, reasonDetails: body.reasonDetails, requestedEntryAt: body.requestedEntryAt, durationMinutes: body.durationMinutes },
        });
        toast(t('request.modified'));
        clearDraft();
        void qc.invalidateQueries({ queryKey: ['my-visits'] });
        router.replace(`/visitor/visits/${res.visit.id}`);
        return;
      }
      const res = await api<{ visit: VisitDTO }>('/me/visits', { body });
      clearDraft();
      setSubmitted(res.visit);
      setStep(2);
      void qc.invalidateQueries({ queryKey: ['my-visits'] });
    } catch (err) {
      if (isApiError(err)) {
        const mapped = serverErrorsToDraft(err.fields);
        if (Object.keys(mapped).length) {
          setErrors(mapped);
          setStep(0);
        }
        setSubmitError(err.messageKey);
      } else setSubmitError('errors.internal_error');
    } finally {
      setBusy(false);
    }
  }

  if (editId && editing.isLoading) return <LoadingRows rows={4} />;
  if (editId && editing.isError) return <ErrorState error={editing.error} onRetry={() => void editing.refetch()} />;

  const visitor = session?.visitor;
  const labels = [t('request.stepDetails'), t('request.stepReview'), t('request.stepDone')];

  return (
    <div>
      <PageHeader title={editId ? t('request.modifyTitle') : t('request.title')} />
      <StepIndicator step={step} labels={labels} />

      {gate.data && step < 2 && (
        <Banner tone="info" className="mb-4">
          {t('request.gateFromQr', { gate: locale === 'ar' ? gate.data.nameAr : gate.data.nameEn })}
        </Banner>
      )}
      {editId && editing.data?.status === 'approved' && step < 2 && (
        <Banner tone="warning" className="mb-4">
          {t('request.modifyApprovedWarning')}
        </Banner>
      )}
      {restored && step === 0 && !editId && (
        <Banner
          tone="info"
          className="mb-4"
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-4" aria-hidden />}
              onClick={() => {
                clearDraft();
                setDraft(initial);
              }}
            >
              {t('request.discardDraft')}
            </Button>
          }
        >
          {t('request.draftRestored')}
        </Banner>
      )}
      {visitor?.documentExpired && (
        <Banner tone="danger" icon={<ShieldAlert className="size-5" aria-hidden />} className="mb-4">
          {t('visitor.documentExpiredWarning')}
        </Banner>
      )}
      {submitError && step < 2 && (
        <Banner tone="danger" className="mb-4">
          {t.dynamic(submitError)}
        </Banner>
      )}
      {!online && step < 2 && (
        <Banner tone="warning" className="mb-4">
          {t('connectivity.offlineHint')}
        </Banner>
      )}

      {step === 0 && (
        <Card className="p-5 sm:p-6 animate-fade-in">
          <VisitDetailsForm draft={draft} onChange={setDraft} errors={errors} maxDurationMinutes={config?.maxVisitDurationMinutes ?? 720} />
          <div className="mt-8 flex justify-end">
            <Button size="lg" onClick={goReview} className="min-w-44">
              {t('common.next')}
              <ArrowLeft className="size-5 ltr:rotate-180" aria-hidden />
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <h2 className="text-lg font-bold text-navy-900">{t('request.reviewTitle')}</h2>
          <VisitReview
            draft={draft}
            onEdit={() => setStep(0)}
            visitorBlock={
              visitor && (
                <Card className="p-5">
                  <h3 className="mb-4 font-bold text-navy-900">{t('request.visitorSection')}</h3>
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DetailItem label={t('fields.fullName')} value={visitor.fullName} />
                    <DetailItem label={t(`documentTypes.${visitor.documentType}`)} value={visitor.documentNumberMasked} mono />
                    <DetailItem label={t('fields.mobile')} value={visitor.mobileMasked} mono />
                  </dl>
                </Card>
              )
            }
          />
          <Banner tone="info">{t('request.reviewHint')}</Banner>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="secondary" size="lg" onClick={() => setStep(0)} icon={<ArrowRight className="size-5 ltr:rotate-180" aria-hidden />}>
              {t('common.back')}
            </Button>
            <Button size="lg" variant="accent" loading={busy} disabled={!online} onClick={() => void submit()} icon={<Send className="size-5 rtl:-scale-x-100" aria-hidden />} className="min-w-52">
              {busy ? t('request.submitting') : t('request.submit')}
            </Button>
          </div>
        </div>
      )}

      {step === 2 && submitted && (
        <SubmittedConfirmation
          visit={submitted}
          actions={
            <>
              <ButtonLink href={`/visitor/visits/${submitted.id}`} size="lg" variant="accent">
                {t('request.trackStatus')}
              </ButtonLink>
              <ButtonLink href="/visitor/home" size="lg" variant="secondary">
                {t('common.goHome')}
              </ButtonLink>
            </>
          }
        />
      )}
    </div>
  );
}

export default function RequestPage() {
  return (
    <Suspense fallback={<LoadingRows rows={4} />}>
      <RequestWizard />
    </Suspense>
  );
}
