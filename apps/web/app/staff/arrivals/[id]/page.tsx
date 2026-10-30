'use client';

import { AlertTriangle, ArrowRight, Check, IdCard, ImageOff, X, ZoomIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { arrivalApproveSchema, countryName, fieldErrorsFromIssues, type ArrivalDetailDTO, type DocumentType } from '@vms/shared';
import { DocumentExpiryInput, DocumentNumberInput, NationalitySelect, PhoneInput, VillaNumberInput, expiryFromStored, expiryToInput, type ExpiryValue, type PhoneValue } from '@/components/inputs';
import { Dialog } from '@/components/ui/dialog';
import { Banner, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Input, Segmented, Textarea } from '@/components/ui/form';
import { Badge, Button, ButtonLink, Card, CardHeader, DetailItem, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat, usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

interface FormState {
  documentType: DocumentType;
  documentNumber: string;
  fullName: string;
  nationality: string;
  expiry: ExpiryValue;
  phone: PhoneValue;
  villaNumber: string;
}

function formFrom(d: ArrivalDetailDTO): FormState {
  return {
    documentType: d.documentType,
    documentNumber: d.documentNumber,
    fullName: d.fullName,
    nationality: d.nationality,
    expiry: expiryFromStored(d.documentExpiry.date, d.documentExpiry.calendar, d.documentExpiry.original),
    // Saudi numbers are shown in the local form (05…); others stay in international form, which is accepted as typed.
    phone: d.mobile.startsWith('+966') ? { country: 'SA', number: `0${d.mobile.slice(4)}` } : { country: 'SA', number: d.mobile },
    villaNumber: d.villaNumber,
  };
}

/** Administrator verification of an arrival: the ID photo beside the entered (editable) details. */
export default function ArrivalReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const fmt = useFormat();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: config } = usePublicConfig();
  const q = useQuery({ queryKey: ['arrivals', 'detail', id], queryFn: () => api<ArrivalDetailDTO>(`/arrivals/${id}`) });
  const [form, setForm] = useState<FormState | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  useEffect(() => {
    if (q.data && !form) setForm(formFrom(q.data));
  }, [q.data, form]);

  const done = (message: string) => {
    toast(message);
    void qc.invalidateQueries({ queryKey: ['arrivals'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    router.push('/staff/arrivals');
  };
  const body = (f: FormState) => ({
    documentType: f.documentType,
    documentNumber: f.documentNumber,
    fullName: f.fullName,
    nationality: f.nationality,
    documentExpiry: expiryToInput(f.expiry),
    mobile: f.phone.number,
    mobileCountry: f.phone.country,
    villaNumber: f.villaNumber,
  });
  const approve = useMutation({
    mutationFn: (f: FormState) => api<ArrivalDetailDTO>(`/arrivals/${id}/approve`, { body: body(f) }),
    onSuccess: () => done(t('arrivals.approved')),
    onError: (err) => {
      setApproveOpen(false);
      if (isApiError(err)) setFields(err.fields);
    },
  });
  const reject = useMutation({
    mutationFn: () => api<ArrivalDetailDTO>(`/arrivals/${id}/reject`, { body: { reason: reason.trim() } }),
    onSuccess: () => done(t('arrivals.rejected')),
    onError: (err) => {
      if (isApiError(err) && err.fields.reason) setReasonError(err.fields.reason);
    },
  });

  if (q.isLoading || (q.data && !form)) return <LoadingRows rows={8} />;
  if (q.isError || !q.data || !form) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const pending = d.status === 'pending';
  const ex = d.existingVisitor;
  const differs = (a: string, b: string) => a.trim() !== b.trim();
  const decisionError = approve.error ?? reject.error;

  function openApprove() {
    const parsed = arrivalApproveSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse(body(form!));
    if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
    setFields({});
    setApproveOpen(true);
  }

  return (
    <div>
      <PageHeader
        title={t('arrivals.reviewTitle')}
        subtitle={`${d.reference} · ${fmt.dateTime(d.createdAt)}`}
        back={
          <Link href="/staff/arrivals" className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700">
            <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
            {t('arrivals.title')}
          </Link>
        }
      />
      {!pending && (
        <Banner tone={d.status === 'approved' ? 'success' : 'warning'} className="mb-4">
          {t('arrivals.decided')}: {t(`arrivals.tabs.${d.status}`)}
          {d.decidedAt && ` · ${fmt.dateTime(d.decidedAt)}`}
          {d.decidedBy?.name && ` · ${d.decidedBy.name}`}
          {d.rejectReason && ` — ${d.rejectReason === 'expired' ? t('arrival.expiredReason') : d.rejectReason}`}
        </Banner>
      )}
      {decisionError && isApiError(decisionError) && !Object.keys(decisionError.fields).length && (
        <Banner tone="danger" className="mb-4">
          {t.dynamic(decisionError.messageKey)}
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('arrivals.idImage')} icon={<IdCard className="size-5" aria-hidden />} />
            <div className="p-4">
              {d.hasImage ? (
                <button type="button" onClick={() => setZoom(true)} className="group relative block w-full overflow-hidden rounded-xl border border-line bg-navy-50" aria-label={t('arrivals.idImage')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/v1/arrivals/${d.id}/image`} alt={t('arrivals.idImage')} className="mx-auto max-h-[420px] w-full object-contain" />
                  <span className="absolute bottom-2 end-2 grid size-9 place-items-center rounded-full bg-navy-900/80 text-white opacity-90 group-hover:opacity-100">
                    <ZoomIn className="size-5" aria-hidden />
                  </span>
                </button>
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-amber-900">
                  <ImageOff className="size-5 shrink-0" aria-hidden />
                  <p className="text-sm">{d.imageRemoved ? t('arrivals.imageRemoved') : t('arrivals.imageMissing')}</p>
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title={t('arrivals.visitDetails')} />
            <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <DetailItem label={t('fields.reason')} value={d.reason === 'other' ? `${t('reasons.other')}: ${d.reasonDetails ?? ''}` : t(`reasons.${d.reason}`)} />
              <DetailItem label={t('fields.entryAt')} value={fmt.dateTime(d.requestedEntryAt)} />
              <DetailItem label={t('fields.duration')} value={fmt.duration(d.durationMinutes)} />
              {d.requestedGate && <DetailItem label={t('fields.gate')} value={locale === 'ar' ? d.requestedGate.nameAr : d.requestedGate.nameEn} />}
            </dl>
            {d.visitId && (
              <div className="border-t border-line p-4">
                <ButtonLink href={`/staff/visits/${d.visitId}`} variant="secondary" size="sm">
                  {t('arrivals.openVisit')}
                </ButtonLink>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {ex && (
            <Card>
              <CardHeader title={t('arrivals.existingProfile')} />
              <div className="space-y-3 p-5">
                {ex.hasOpenVisit && (
                  <Banner tone="warning" icon={<AlertTriangle className="size-5" aria-hidden />}>
                    {t('arrivals.hasOpenVisit')}
                  </Banner>
                )}
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DetailItem label={t('fields.fullName')} value={<>{ex.fullName} {differs(ex.fullName, form.fullName) && <Badge tone="amber">{t('arrivals.differs')}</Badge>}</>} />
                  <DetailItem label={t('fields.mobile')} value={<><span className="ltr-nums" dir="ltr">{ex.mobile}</span> {differs(ex.mobile, form.phone.number.startsWith('0') ? `+966${form.phone.number.slice(1)}` : form.phone.number) && <Badge tone="amber">{t('arrivals.differs')}</Badge>}</>} />
                  <DetailItem label={t('fields.nationality')} value={countryName(ex.nationality, locale)} />
                  <DetailItem label={t('fields.documentExpiry')} value={fmt.ymd(ex.documentExpiryDate)} />
                </dl>
                <p className="text-xs text-muted">{t('arrivals.existingNote')}</p>
                <ButtonLink href={`/staff/visitors/${ex.id}`} variant="ghost" size="sm">
                  {t('nav.visitors')}
                </ButtonLink>
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title={t('arrivals.enteredData')} />
            <fieldset disabled={!pending} className="space-y-5 p-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label={t('fields.documentType')} required>
                  {() => (
                    <Segmented
                      label={t('fields.documentType')}
                      value={form.documentType}
                      onChange={(v) => setForm({ ...form, documentType: v })}
                      options={[
                        { value: 'national_id', label: t('documentTypes.national_id') },
                        { value: 'iqama', label: t('documentTypes.iqama') },
                      ]}
                    />
                  )}
                </Field>
                <DocumentNumberInput value={form.documentNumber} onChange={(v) => setForm({ ...form, documentNumber: v })} error={fields.documentNumber} />
              </div>
              <Field label={t('fields.fullName')} required error={fields.fullName}>
                {(a) => <Input {...a} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}
              </Field>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <NationalitySelect value={form.nationality} onChange={(v) => setForm({ ...form, nationality: v })} error={fields.nationality} />
                <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} error={fields.mobile} />
              </div>
              <DocumentExpiryInput value={form.expiry} onChange={(v) => setForm({ ...form, expiry: v })} error={fields['documentExpiry.date'] ?? fields.documentExpiry} />
              <VillaNumberInput value={form.villaNumber} onChange={(v) => setForm({ ...form, villaNumber: v })} error={fields.villaNumber} />
            </fieldset>
            {pending && (
              <div className="flex flex-wrap justify-end gap-3 border-t border-line p-4">
                <Button variant="danger" icon={<X className="size-5" aria-hidden />} onClick={() => setRejectOpen(true)}>
                  {t('arrivals.reject')}
                </Button>
                <Button variant="success" size="lg" icon={<Check className="size-5" aria-hidden />} onClick={openApprove}>
                  {t('arrivals.approve')}
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={zoom} onClose={() => setZoom(false)} title={t('arrivals.idImage')} size="lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/v1/arrivals/${d.id}/image`} alt={t('arrivals.idImage')} className="w-full rounded-xl object-contain" />
      </Dialog>
      <Dialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={t('arrivals.approve')}
        description={t('arrivals.approveConfirm')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setApproveOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="success" loading={approve.isPending} onClick={() => approve.mutate(form)}>
              {t('common.confirm')}
            </Button>
          </>
        }
      />
      <Dialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('arrivals.reject')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={reject.isPending} onClick={() => reject.mutate()}>
              {t('arrivals.reject')}
            </Button>
          </>
        }
      >
        <Field label={t('arrivals.reject')} required error={reasonError}>
          {(a) => <Textarea {...a} maxLength={500} placeholder={t('arrivals.rejectPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Dialog>
    </div>
  );
}
