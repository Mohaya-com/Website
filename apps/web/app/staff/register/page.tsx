'use client';

import { AlertTriangle, ArrowLeft, ArrowRight, IdCard, Pencil, Search, Send, UserPlus, UserRoundCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fieldErrorsFromIssues,
  inferDocumentType,
  normalizeIdentifier,
  visitorCreateSchema,
  visitorLookupSchema,
  zonedDateString,
  zonedTimeString,
  type DocumentType,
  type VisitDTO,
  type VisitorFullDTO,
} from '@vms/shared';
import { DocumentExpiryInput, DocumentNumberInput, NationalitySelect, PhoneInput, defaultSchedule, emptyExpiry, expiryToInput, type ExpiryValue, type PhoneValue } from '@/components/inputs';
import { Banner, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Segmented } from '@/components/ui/form';
import { Button, ButtonLink, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { VisitorEditDialog } from '@/components/visitor-edit-dialog';
import { StepIndicator, SubmittedConfirmation, VisitDetailsForm, VisitReview, draftToBody, serverErrorsToDraft, validateDraft, type DraftErrors, type VisitDraft } from '@/components/visit-request';
import { VisitorIdentityGrid } from '@/components/visit-views';
import { api, isApiError } from '@/lib/api';
import { useOnline, usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

type LookupState = { kind: 'none' } | { kind: 'found'; visitor: VisitorFullDTO; duplicate?: boolean } | { kind: 'notFound'; documentNumber: string };

/** Identity data is held in memory only on this screen (never persisted in the browser). */
function NewVisitorForm({ documentNumber, onCreated, onDuplicate }: { documentNumber: string; onCreated: (v: VisitorFullDTO) => void; onDuplicate: (number: string) => void }) {
  const { t } = useI18n();
  const { data: config } = usePublicConfig();
  const [documentType, setDocumentType] = useState<DocumentType>(inferDocumentType(documentNumber) ?? 'national_id');
  const [number, setNumber] = useState(documentNumber);
  const [fullName, setFullName] = useState('');
  const [nationality, setNationality] = useState(inferDocumentType(documentNumber) === 'national_id' ? 'SA' : '');
  const [expiry, setExpiry] = useState<ExpiryValue>(emptyExpiry());
  const [phone, setPhone] = useState<PhoneValue>({ country: 'SA', number: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { fullName, documentType, documentNumber: number, documentExpiry: expiryToInput(expiry), nationality, mobile: phone.number, mobileCountry: phone.country };
    const parsed = visitorCreateSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse(body);
    if (!parsed.success) {
      setFields(fieldErrorsFromIssues(parsed.error.issues));
      return;
    }
    setFields({});
    setBusy(true);
    try {
      onCreated(await api<VisitorFullDTO>('/visitors', { body }));
    } catch (err) {
      if (isApiError(err) && err.code === 'duplicate_visitor') onDuplicate(parsed.data.documentNumber);
      else if (isApiError(err)) {
        setFields(err.fields);
        setError(err.messageKey);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 p-5">
      {error && <Banner tone="danger">{t.dynamic(error)}</Banner>}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t('fields.documentType')} required>
          {() => (
            <Segmented
              label={t('fields.documentType')}
              size="lg"
              value={documentType}
              onChange={setDocumentType}
              options={[
                { value: 'national_id', label: t('documentTypes.national_id') },
                { value: 'iqama', label: t('documentTypes.iqama') },
              ]}
            />
          )}
        </Field>
        <DocumentNumberInput value={number} onChange={setNumber} error={fields.documentNumber} />
      </div>
      <Field label={t('fields.fullName')} required error={fields.fullName} hint={t('fields.fullNameHint')}>
        {(a) => <Input {...a} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />}
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <NationalitySelect value={nationality} onChange={setNationality} error={fields.nationality} />
        <PhoneInput value={phone} onChange={setPhone} error={fields.mobile} />
      </div>
      <DocumentExpiryInput value={expiry} onChange={setExpiry} error={fields['documentExpiry.date'] ?? fields.documentExpiry} />
      <div className="flex justify-end">
        <Button type="submit" size="lg" variant="accent" loading={busy} icon={<UserPlus className="size-5" aria-hidden />}>
          {t('returning.createNew')}
        </Button>
      </div>
    </form>
  );
}

function RegisterFlow() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const online = useOnline();
  const search = useSearchParams();
  const editId = search.get('edit');
  const { data: config } = usePublicConfig();
  const tz = config?.timezone ?? 'Asia/Riyadh';

  const [step, setStep] = useState(editId ? 1 : 0);
  const [query, setQuery] = useState('');
  const [queryError, setQueryError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookup, setLookup] = useState<LookupState>({ kind: 'none' });
  const [confirmed, setConfirmed] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<VisitDraft>({ villaNumber: '', reason: null, reasonDetails: '', schedule: defaultSchedule(tz, config?.defaultVisitDurationMinutes ?? 120), requestedGateId: null });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [clientRequestId, setClientRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<VisitDTO | null>(null);

  const editing = useQuery({ queryKey: ['visit', editId], queryFn: () => api<VisitDTO>(`/visits/${editId}`), enabled: Boolean(editId) });
  useEffect(() => {
    const v = editing.data;
    if (!v) return;
    setDraft({
      villaNumber: v.villa.number,
      reason: v.reason,
      reasonDetails: v.reasonDetails ?? '',
      schedule: { date: zonedDateString(new Date(v.requestedEntryAt), tz), time: zonedTimeString(new Date(v.requestedEntryAt), tz), durationMinutes: v.durationMinutes },
      requestedGateId: v.requestedGate?.id ?? null,
    });
  }, [editing.data, tz]);

  const visitor = lookup.kind === 'found' ? lookup.visitor : null;

  async function runLookup(numberOverride?: string, duplicate = false) {
    const raw = numberOverride ?? query;
    const parsed = visitorLookupSchema.safeParse({ documentNumber: raw });
    if (!parsed.success) {
      setQueryError(fieldErrorsFromIssues(parsed.error.issues).documentNumber ?? 'validation.invalid');
      return;
    }
    setQueryError(null);
    setSearching(true);
    setConfirmed(false);
    try {
      const res = await api<{ found: boolean; visitor: VisitorFullDTO | null }>(`/visitors/lookup?documentNumber=${encodeURIComponent(parsed.data.documentNumber)}`);
      setLookup(res.found && res.visitor ? { kind: 'found', visitor: res.visitor, duplicate } : { kind: 'notFound', documentNumber: parsed.data.documentNumber });
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
    setClientRequestId(crypto.randomUUID());
    setSubmitError(null);
    setStep(2);
  }

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const body = draftToBody(draft, tz, clientRequestId);
      if (editId && editing.data) {
        const res = await api<{ visit: VisitDTO; replaced: boolean }>(`/visits/${editId}`, {
          method: 'PATCH',
          body: { expectedVersion: editing.data.version, villaNumber: body.villaNumber, reason: body.reason, reasonDetails: body.reasonDetails, requestedEntryAt: body.requestedEntryAt, durationMinutes: body.durationMinutes },
        });
        toast(t('request.modified'));
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
    setDraft({ villaNumber: '', reason: null, reasonDetails: '', schedule: defaultSchedule(tz, config?.defaultVisitDurationMinutes ?? 120), requestedGateId: null });
    setErrors({});
  };

  if (editId && editing.isLoading) return <LoadingRows rows={5} />;
  if (editId && editing.isError) return <ErrorState error={editing.error} />;
  const labels = [t('request.stepVisitor'), t('request.stepDetails'), t('request.stepReview'), t('request.stepDone')];

  return (
    <div>
      <PageHeader title={editId ? t('request.modifyTitle') : t('request.onBehalfTitle')} />
      <StepIndicator step={step} labels={labels} />
      {submitError && step < 3 && (
        <Banner tone="danger" className="mb-4">
          {t.dynamic(submitError)}
        </Banner>
      )}
      {editId && editing.data?.status === 'approved' && step < 3 && (
        <Banner tone="warning" className="mb-4">
          {t('request.modifyApprovedWarning')}
        </Banner>
      )}

      {step === 0 && (
        <div className="space-y-5 animate-fade-in">
          <Card>
            <CardHeader title={t('returning.title')} subtitle={t('returning.subtitle')} icon={<Search className="size-5" aria-hidden />} />
            <form
              className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start"
              onSubmit={(e) => {
                e.preventDefault();
                void runLookup();
              }}
            >
              <div className="flex-1">
                <DocumentNumberInput value={query} onChange={setQuery} error={queryError} autoFocus />
              </div>
              <Button type="submit" size="lg" className="sm:mt-7 sm:min-w-36" loading={searching} icon={<Search className="size-5" aria-hidden />}>
                {t('common.search')}
              </Button>
            </form>
          </Card>

          {lookup.kind === 'found' && (
            <Card className="animate-slide-up">
              <CardHeader
                title={t('returning.found')}
                subtitle={t('returning.confirmDetails')}
                icon={<UserRoundCheck className="size-5" aria-hidden />}
                actions={
                  <Button variant="secondary" size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditOpen(true)}>
                    {t('returning.editProfile')}
                  </Button>
                }
              />
              <div className="space-y-4 p-5">
                {lookup.duplicate && <Banner tone="info">{t('returning.duplicateFound')}</Banner>}
                <VisitorIdentityGrid visitor={lookup.visitor} />
                {lookup.visitor.hasOpenVisit && (
                  <Banner tone="warning" icon={<AlertTriangle className="size-5" aria-hidden />}>
                    {t('returning.hasOpenVisit')}
                  </Banner>
                )}
                <Checkbox checked={confirmed} onChange={setConfirmed} label={t('returning.detailsConfirmed')} />
                <div className="flex justify-end">
                  <Button size="lg" disabled={!confirmed || lookup.visitor.documentExpired} onClick={() => setStep(1)}>
                    {t('returning.useProfile')}
                    <ArrowLeft className="size-5 ltr:rotate-180" aria-hidden />
                  </Button>
                </div>
                {lookup.visitor.documentExpired && <Banner tone="danger">{t('errors.document_expired')}</Banner>}
              </div>
              <VisitorEditDialog
                key={lookup.visitor.version}
                visitor={lookup.visitor}
                open={editOpen}
                onClose={() => setEditOpen(false)}
                onSaved={(v) => {
                  setLookup({ kind: 'found', visitor: v });
                  setEditOpen(false);
                  toast(t('admin.profileUpdated'));
                }}
              />
            </Card>
          )}

          {lookup.kind === 'notFound' && (
            <Card className="animate-slide-up">
              <CardHeader title={t('returning.notFound')} subtitle={t('returning.notFoundHint')} icon={<IdCard className="size-5" aria-hidden />} />
              <NewVisitorForm
                key={lookup.documentNumber}
                documentNumber={lookup.documentNumber}
                onCreated={(v) => {
                  toast(t('returning.profileCreated'));
                  setLookup({ kind: 'found', visitor: v });
                  setConfirmed(true);
                }}
                onDuplicate={(n) => {
                  setQuery(n);
                  void runLookup(normalizeIdentifier(n), true);
                }}
              />
            </Card>
          )}
        </div>
      )}

      {step === 1 && (
        <Card className="p-5 sm:p-6 animate-fade-in">
          {visitor && (
            <div className="mb-6 flex items-center gap-3 rounded-xl bg-navy-50 p-3">
              <UserRoundCheck className="size-5 text-navy-700" aria-hidden />
              <span className="font-bold text-navy-900">{visitor.fullName}</span>
              <span className="text-sm text-muted ltr-nums">{visitor.documentNumberMasked}</span>
            </div>
          )}
          <VisitDetailsForm draft={draft} onChange={setDraft} errors={errors} maxDurationMinutes={config?.maxVisitDurationMinutes ?? 720} />
          <div className="mt-8 flex justify-between">
            {!editId ? (
              <Button variant="secondary" size="lg" onClick={() => setStep(0)} icon={<ArrowRight className="size-5 ltr:rotate-180" aria-hidden />}>
                {t('common.back')}
              </Button>
            ) : (
              <span />
            )}
            <Button size="lg" onClick={goReview}>
              {t('common.next')}
              <ArrowLeft className="size-5 ltr:rotate-180" aria-hidden />
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-fade-in">
          <h2 className="text-lg font-bold text-navy-900">{t('request.reviewTitle')}</h2>
          <VisitReview
            draft={draft}
            onEdit={() => setStep(1)}
            visitorBlock={
              visitor ? (
                <Card className="p-5">
                  <h3 className="mb-4 font-bold text-navy-900">{t('request.visitorSection')}</h3>
                  <VisitorIdentityGrid visitor={visitor} />
                </Card>
              ) : editing.data?.visitor ? (
                <Card className="p-5">
                  <h3 className="mb-4 font-bold text-navy-900">{t('request.visitorSection')}</h3>
                  <VisitorIdentityGrid visitor={editing.data.visitor} />
                </Card>
              ) : undefined
            }
          />
          <Banner tone="info">{t('request.reviewHint')}</Banner>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="secondary" size="lg" onClick={() => setStep(1)} icon={<ArrowRight className="size-5 ltr:rotate-180" aria-hidden />}>
              {t('common.back')}
            </Button>
            <Button size="lg" variant="accent" loading={busy} disabled={!online} onClick={() => void submit()} icon={<Send className="size-5 rtl:-scale-x-100" aria-hidden />}>
              {busy ? t('request.submitting') : t('request.submit')}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && submitted && (
        <SubmittedConfirmation
          visit={submitted}
          actions={
            <>
              <ButtonLink href={`/staff/visits/${submitted.id}`} size="lg" variant="accent">
                {t('common.seeDetails')}
              </ButtonLink>
              <Button size="lg" variant="secondary" onClick={resetAll} icon={<UserPlus className="size-5" aria-hidden />}>
                {t('security.registerVisitor')}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

export default function StaffRegisterPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <RegisterFlow />
    </Suspense>
  );
}
