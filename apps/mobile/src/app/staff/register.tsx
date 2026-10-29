import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, ArrowLeft, Pencil, Search, Send, UserPlus, UserRoundCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { zonedDateString, zonedTimeString, type VisitDTO, type VisitorFullDTO } from '@vms/shared';
import { DocumentNumberInput, defaultSchedule } from '@/components/inputs';
import { AppText, Banner, Button, Card, Checkbox, ErrorState, Loading, Row, Screen } from '@/components/ui';
import { VisitorIdentity } from '@/components/visit';
import { StepIndicator, SubmittedView, VisitDetailsForm, VisitReview, draftToBody, newClientRequestId, serverErrorsToDraft, validateDraft, type DraftErrors, type VisitDraft } from '@/features/request';
import { NewVisitorForm, VisitorEditForm } from '@/features/visitor-edit';
import { api, isApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useOnline } from '@/lib/network';
import { colors, flipX, ltr, space } from '@/lib/theme';

type Lookup = { kind: 'none' } | { kind: 'found'; visitor: VisitorFullDTO; duplicate?: boolean } | { kind: 'notFound'; documentNumber: string };

/**
 * Staff-assisted request: «بحث» by ID number → confirm (or create) the profile → visit details → review → submit.
 * Identity data is kept in memory only for this screen.
 */
export default function StaffRegister() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const online = useOnline();
  const params = useLocalSearchParams<{ edit?: string }>();
  const editId = params.edit;
  const { data: config } = usePublicConfig();
  const tz = config?.timezone ?? 'Asia/Riyadh';
  const newDraft = (): VisitDraft => ({ villaId: '', reason: null, reasonDetails: '', schedule: defaultSchedule(tz, config?.defaultVisitDurationMinutes ?? 120), requestedGateId: null });

  const [step, setStep] = useState(editId ? 1 : 0);
  const [query, setQuery] = useState('');
  const [queryError, setQueryError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookup, setLookup] = useState<Lookup>({ kind: 'none' });
  const [confirmed, setConfirmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<VisitDraft>(newDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [clientRequestId, setClientRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<VisitDTO | null>(null);

  const existing = useQuery({ queryKey: ['visit', editId], queryFn: () => api<VisitDTO>(`/visits/${editId}`), enabled: Boolean(editId) });
  useEffect(() => {
    const v = existing.data;
    if (!v) return;
    setDraft({ villaId: v.villa.id, reason: v.reason, reasonDetails: v.reasonDetails ?? '', schedule: { date: zonedDateString(new Date(v.requestedEntryAt), tz), time: zonedTimeString(new Date(v.requestedEntryAt), tz), durationMinutes: v.durationMinutes }, requestedGateId: v.requestedGate?.id ?? null });
  }, [existing.data, tz]);

  const visitor = lookup.kind === 'found' ? lookup.visitor : null;

  async function runLookup(number = query, duplicate = false) {
    if (!/^\d{10}$/.test(number)) return setQueryError('validation.document.length');
    setQueryError(null);
    setSearching(true);
    setConfirmed(false);
    try {
      const res = await api<{ found: boolean; visitor: VisitorFullDTO | null }>(`/visitors/lookup?documentNumber=${number}`);
      setLookup(res.found && res.visitor ? { kind: 'found', visitor: res.visitor, duplicate } : { kind: 'notFound', documentNumber: number });
    } catch (err) {
      setQueryError(isApiError(err) ? err.messageKey : 'errors.internal_error');
    } finally {
      setSearching(false);
    }
  }

  function goReview() {
    const errs = validateDraft(draft, config, visitor?.documentExpiryDate);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setClientRequestId(newClientRequestId());
    setSubmitError(null);
    setStep(2);
  }

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const body = draftToBody(draft, tz, clientRequestId);
      if (editId && existing.data) {
        const res = await api<{ visit: VisitDTO }>(`/visits/${editId}`, { method: 'PATCH', body: { expectedVersion: existing.data.version, villaId: body.villaId, reason: body.reason, reasonDetails: body.reasonDetails, requestedEntryAt: body.requestedEntryAt, durationMinutes: body.durationMinutes } });
        setSubmitted(res.visit);
      } else {
        const res = await api<{ visit: VisitDTO }>('/visits', { body: { ...body, visitorId: visitor!.id } });
        setSubmitted(res.visit);
      }
      setStep(3);
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      if (isApiError(err)) {
        const mapped = serverErrorsToDraft(err.fields);
        if (Object.keys(mapped).length) {
          setErrors(mapped);
          setStep(1);
        }
        setSubmitError(err.messageKey);
      } else setSubmitError('errors.internal_error');
    } finally {
      setBusy(false);
    }
  }

  const resetAll = () => {
    setStep(0);
    setQuery('');
    setLookup({ kind: 'none' });
    setConfirmed(false);
    setSubmitted(null);
    setDraft(newDraft());
    setErrors({});
  };

  if (editId && existing.isLoading) return <Loading />;
  if (editId && existing.isError) return <ErrorState error={existing.error} />;

  return (
    <Screen edges={['bottom']}>
      <StepIndicator step={step} labels={[t('request.stepVisitor'), t('request.stepDetails'), t('request.stepReview'), t('request.stepDone')]} />
      {submitError && step < 3 ? <Banner tone="danger">{t.dynamic(submitError)}</Banner> : null}
      {existing.data?.status === 'approved' && step < 3 ? <Banner tone="warning">{t('request.modifyApprovedWarning')}</Banner> : null}

      {step === 0 ? (
        <>
          <Card style={{ gap: space.md }}>
            <AppText variant="subheading">{t('returning.title')}</AppText>
            <AppText variant="caption">{t('returning.subtitle')}</AppText>
            <DocumentNumberInput value={query} onChange={setQuery} error={queryError} onSubmit={() => void runLookup()} />
            <Button title={t('common.search')} size="lg" loading={searching} icon={<Search size={20} color={colors.white} />} onPress={() => void runLookup()} />
          </Card>
          {lookup.kind === 'found' ? (
            editing ? (
              <VisitorEditForm
                visitor={lookup.visitor}
                onCancel={() => setEditing(false)}
                onSaved={(v) => {
                  setLookup({ kind: 'found', visitor: v });
                  setEditing(false);
                }}
              />
            ) : (
              <Card style={{ gap: space.md }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row gap={6}>
                    <UserRoundCheck size={20} color={colors.teal700} />
                    <AppText variant="subheading">{t('returning.found')}</AppText>
                  </Row>
                  <Button title={t('returning.editProfile')} variant="ghost" size="sm" icon={<Pencil size={16} color={colors.navy800} />} onPress={() => setEditing(true)} />
                </Row>
                {lookup.duplicate ? <Banner tone="info">{t('returning.duplicateFound')}</Banner> : null}
                <AppText variant="caption">{t('returning.confirmDetails')}</AppText>
                <VisitorIdentity visitor={lookup.visitor} />
                {lookup.visitor.hasOpenVisit ? <Banner tone="warning" icon={<AlertTriangle size={18} color={colors.amber800} />}>{t('returning.hasOpenVisit')}</Banner> : null}
                {lookup.visitor.documentExpired ? <Banner tone="danger">{t('errors.document_expired')}</Banner> : null}
                <Checkbox checked={confirmed} onChange={setConfirmed} label={t('returning.detailsConfirmed')} />
                <Button title={t('returning.useProfile')} size="lg" disabled={!confirmed || lookup.visitor.documentExpired} onPress={() => setStep(1)} icon={<ArrowLeft size={20} color={colors.white} style={flipX()} />} />
              </Card>
            )
          ) : null}
          {lookup.kind === 'notFound' ? (
            <>
              <Banner tone="info" title={t('returning.notFound')}>
                {t('returning.notFoundHint')}
              </Banner>
              <NewVisitorForm
                key={lookup.documentNumber}
                documentNumber={lookup.documentNumber}
                onCreated={(v) => {
                  setLookup({ kind: 'found', visitor: v });
                  setConfirmed(true);
                }}
                onDuplicate={(n) => {
                  setQuery(n);
                  void runLookup(n, true);
                }}
              />
            </>
          ) : null}
        </>
      ) : null}

      {step === 1 ? (
        <>
          {visitor ? (
            <Card style={{ backgroundColor: colors.navy50 }}>
              <Row>
                <UserRoundCheck size={18} color={colors.navy700} />
                <AppText weight="bold">{visitor.fullName}</AppText>
                <AppText variant="small">{ltr(visitor.documentNumberMasked)}</AppText>
              </Row>
            </Card>
          ) : null}
          <VisitDetailsForm draft={draft} onChange={setDraft} errors={errors} maxDurationMinutes={config?.maxVisitDurationMinutes ?? 720} />
          <Button title={t('common.next')} size="lg" onPress={goReview} icon={<ArrowLeft size={20} color={colors.white} style={flipX()} />} />
          {!editId ? <Button title={t('common.back')} variant="secondary" onPress={() => setStep(0)} /> : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <VisitReview
            draft={draft}
            onEdit={() => setStep(1)}
            visitorBlock={visitor ?? existing.data?.visitor ? <Card><VisitorIdentity visitor={(visitor ?? existing.data!.visitor)!} /></Card> : undefined}
          />
          <Banner tone="info">{t('request.reviewHint')}</Banner>
          <Button title={busy ? t('request.submitting') : t('request.submit')} variant="accent" size="lg" loading={busy} disabled={!online} onPress={() => void submit()} icon={<Send size={20} color={colors.white} style={flipX()} />} />
          <Button title={t('common.back')} variant="secondary" onPress={() => setStep(1)} />
        </>
      ) : null}

      {step === 3 && submitted ? (
        <SubmittedView
          visit={submitted}
          actions={
            <>
              <Button title={t('common.seeDetails')} variant="accent" onPress={() => router.replace(`/staff/visit/${submitted.id}`)} />
              <Button title={t('security.registerVisitor')} variant="secondary" icon={<UserPlus size={18} color={colors.navy900} />} onPress={resetAll} />
            </>
          }
        />
      ) : null}
    </Screen>
  );
}
