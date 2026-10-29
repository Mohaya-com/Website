import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ArrowRight, RotateCcw, Send } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { zonedDateString, zonedTimeString, type PublicGateDTO, type VisitDTO } from '@vms/shared';
import { defaultSchedule } from '@/components/inputs';
import { Banner, Button, Card, Detail, DetailGrid, ErrorState, Loading, Row, Screen, ScreenTitle } from '@/components/ui';
import { StepIndicator, SubmittedView, VisitDetailsForm, VisitReview, draftToBody, newClientRequestId, serverErrorsToDraft, validateDraft, type DraftErrors, type VisitDraft } from '@/features/request';
import { api, isApiError } from '@/lib/api';
import { useDraft, usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useOnline } from '@/lib/network';
import { useSession } from '@/lib/session';
import { colors, flipX, ltr } from '@/lib/theme';

/** طلب زيارة جديدة — details → review → confirmation. Also used to modify a request (?edit=id). */
export default function RequestScreen() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const online = useOnline();
  const params = useLocalSearchParams<{ edit?: string; gate?: string }>();
  const editId = params.edit;
  const { data: config } = usePublicConfig();
  const { session } = useSession();
  const tz = config?.timezone ?? 'Asia/Riyadh';
  const initial: VisitDraft = { villaId: '', reason: null, reasonDetails: '', schedule: defaultSchedule(tz, config?.defaultVisitDurationMinutes ?? 120), requestedGateId: null };
  const [draft, setDraft, clearDraft, restored] = useDraft<VisitDraft>(editId ? `edit.${editId}` : 'visit-request', initial);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientRequestId, setClientRequestId] = useState('');
  const [submitted, setSubmitted] = useState<VisitDTO | null>(null);

  const gate = useQuery({ queryKey: ['public-gate', params.gate], queryFn: () => api<PublicGateDTO>(`/public/gates/${params.gate}`), enabled: Boolean(params.gate), retry: false });
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
    if (Object.keys(errs).length) return;
    setClientRequestId(newClientRequestId());
    setSubmitError(null);
    setStep(1);
  }

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const body = draftToBody(draft, tz, clientRequestId);
      if (editId && editing.data) {
        const res = await api<{ visit: VisitDTO }>(`/me/visits/${editId}`, {
          method: 'PATCH',
          body: { expectedVersion: editing.data.version, villaId: body.villaId, reason: body.reason, reasonDetails: body.reasonDetails, requestedEntryAt: body.requestedEntryAt, durationMinutes: body.durationMinutes },
        });
        clearDraft();
        void qc.invalidateQueries({ queryKey: ['my-visits'] });
        router.replace(`/visit/${res.visit.id}`);
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

  const reset = () => {
    clearDraft();
    setDraft(initial);
    setSubmitted(null);
    setErrors({});
    setStep(0);
  };

  if (editId && editing.isLoading) return <Loading />;
  if (editId && editing.isError) return <ErrorState error={editing.error} onRetry={() => void editing.refetch()} />;
  const visitor = session?.visitor;

  return (
    <Screen>
      <ScreenTitle title={editId ? t('request.modifyTitle') : t('request.title')} />
      <StepIndicator step={step} labels={[t('request.stepDetails'), t('request.stepReview'), t('request.stepDone')]} />
      {gate.data && step < 2 ? <Banner tone="info">{t('request.gateFromQr', { gate: locale === 'ar' ? gate.data.nameAr : gate.data.nameEn })}</Banner> : null}
      {editing.data?.status === 'approved' && step < 2 ? <Banner tone="warning">{t('request.modifyApprovedWarning')}</Banner> : null}
      {restored && step === 0 && !editId ? (
        <Banner tone="info" action={<Button title={t('request.discardDraft')} variant="ghost" size="sm" icon={<RotateCcw size={16} color={colors.navy800} />} onPress={reset} />}>
          {t('request.draftRestored')}
        </Banner>
      ) : null}
      {visitor?.documentExpired ? <Banner tone="danger">{t('visitor.documentExpiredWarning')}</Banner> : null}
      {submitError && step < 2 ? <Banner tone="danger">{t.dynamic(submitError)}</Banner> : null}
      {!online && step < 2 ? <Banner tone="warning">{t('connectivity.offlineHint')}</Banner> : null}

      {step === 0 ? (
        <>
          <VisitDetailsForm draft={draft} onChange={setDraft} errors={errors} maxDurationMinutes={config?.maxVisitDurationMinutes ?? 720} />
          <Button title={t('common.next')} size="lg" onPress={goReview} icon={<ArrowLeft size={20} color={colors.white} style={flipX()} />} />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <VisitReview
            draft={draft}
            onEdit={() => setStep(0)}
            visitorBlock={
              visitor ? (
                <Card>
                  <DetailGrid>
                    <Detail label={t('fields.fullName')} value={visitor.fullName} wide />
                    <Detail label={t(`documentTypes.${visitor.documentType}`)} value={ltr(visitor.documentNumberMasked)} />
                    <Detail label={t('fields.mobile')} value={ltr(visitor.mobileMasked)} />
                  </DetailGrid>
                </Card>
              ) : undefined
            }
          />
          <Banner tone="info">{t('request.reviewHint')}</Banner>
          <Button title={busy ? t('request.submitting') : t('request.submit')} variant="accent" size="lg" loading={busy} disabled={!online} onPress={() => void submit()} icon={<Send size={20} color={colors.white} style={flipX()} />} />
          <Button title={t('common.back')} variant="secondary" onPress={() => setStep(0)} icon={<ArrowRight size={18} color={colors.navy900} style={flipX()} />} />
        </>
      ) : null}

      {step === 2 && submitted ? (
        <SubmittedView
          visit={submitted}
          actions={
            <>
              <Button title={t('request.trackStatus')} variant="accent" onPress={() => router.push(`/visit/${submitted.id}`)} />
              <Row>
                <Button title={t('visitor.newRequest')} variant="secondary" onPress={reset} style={{ flex: 1 }} />
              </Row>
            </>
          }
        />
      ) : null}
    </Screen>
  );
}
