'use client';

import { ArrowRight, Ban, Pencil, Replace } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PassDTO, VisitDTO } from '@vms/shared';
import { PassCard } from '@/components/pass-card';
import { StatusBadge } from '@/components/status';
import { Dialog } from '@/components/ui/dialog';
import { Banner, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { Button, ButtonLink, Card, CardHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { VisitDetailsGrid, VisitProgress } from '@/components/visit-views';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function VisitStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const visit = useQuery({ queryKey: ['my-visit', id], queryFn: () => api<VisitDTO>(`/me/visits/${id}`), refetchInterval: 15_000 });
  const showPass = visit.data && (visit.data.status === 'approved' || visit.data.status === 'checked_in');
  const pass = useQuery({ queryKey: ['pass', id], queryFn: () => api<PassDTO>(`/me/visits/${id}/pass`), enabled: Boolean(showPass), retry: false });
  const cancel = useMutation({
    mutationFn: () => api<VisitDTO>(`/me/visits/${id}/cancel`, { body: { reason: reason.trim() || undefined } }),
    onSuccess: (v) => {
      qc.setQueryData(['my-visit', id], v);
      void qc.invalidateQueries({ queryKey: ['my-visits'] });
      setCancelOpen(false);
      toast(t('visitor.cancelled'));
    },
  });

  if (visit.isLoading) return <LoadingRows rows={5} />;
  if (visit.isError || !visit.data) return <ErrorState error={visit.error} onRetry={() => void visit.refetch()} />;
  const v = visit.data;
  const whatNext = v.status === 'pending' || v.status === 'approved' || v.status === 'checked_in' ? t(`visitor.whatNext.${v.status}`) : null;

  return (
    <div className="space-y-5">
      <Link href="/visitor/visits" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
        {t('visitor.myVisits')}
      </Link>

      <Card className="overflow-hidden">
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-muted">{t('visitor.statusTitle')}</p>
              <p className="text-xl font-extrabold text-navy-900 ltr-nums">{v.reference}</p>
            </div>
            <StatusBadge status={v.status} overdue={v.isOverdue} />
          </div>
          <p className="text-[15px] text-ink">{t(`statusDescription.${v.status}`)}</p>
          <VisitProgress visit={v} />
          {whatNext && <Banner tone="info">{whatNext}</Banner>}
          {v.rejectionReason && (
            <Banner tone="danger" title={t('fields.rejectionReason')}>
              {v.rejectionReason}
            </Banner>
          )}
          {v.supersededByVisitId && (
            <Banner tone="info" icon={<Replace className="size-5" aria-hidden />} action={<Link className="font-bold underline" href={`/visitor/visits/${v.supersededByVisitId}`}>{t('request.viewReplacement')}</Link>}>
              {t('request.replacedNotice')}
            </Banner>
          )}
        </div>
      </Card>

      {showPass && (pass.isLoading ? <LoadingRows rows={3} /> : pass.data ? <PassCard pass={pass.data} /> : pass.isError ? <ErrorState error={pass.error} onRetry={() => void pass.refetch()} /> : null)}

      <Card>
        <CardHeader title={t('scan.visitDetails')} />
        <div className="p-5">
          <VisitDetailsGrid visit={v} audience="visitor" />
        </div>
      </Card>

      {v.canCancel && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <ButtonLink href={`/visitor/request?edit=${v.id}`} variant="secondary" size="lg" icon={<Pencil className="size-5" aria-hidden />}>
            {t('request.modifyTitle')}
          </ButtonLink>
          <Button variant="danger" size="lg" icon={<Ban className="size-5" aria-hidden />} onClick={() => setCancelOpen(true)}>
            {t('visitor.cancelVisit')}
          </Button>
        </div>
      )}

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('visitor.cancelConfirmTitle')}
        description={t('visitor.cancelConfirmBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              {t('common.back')}
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              {t('visitor.cancelVisit')}
            </Button>
          </>
        }
      >
        {cancel.isError && (
          <Banner tone="danger" className="mb-3">
            {isApiError(cancel.error) ? t.dynamic(cancel.error.messageKey) : t('errors.internal_error')}
          </Banner>
        )}
        <Field label={t('fields.cancelReason')} optional>
          {(a) => <Textarea {...a} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Dialog>
    </div>
  );
}
