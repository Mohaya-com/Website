'use client';

import { ArrowRight, Ban, ClipboardCheck, IdCard, LogOut, Pencil, Printer, QrCode } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission, type PassDTO, type VisitDTO } from '@vms/shared';
import { PassCard } from '@/components/pass-card';
import { StatusBadge } from '@/components/status';
import { Dialog } from '@/components/ui/dialog';
import { Banner, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { Button, ButtonLink, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { VisitDetailsGrid, VisitProgress, VisitorIdentityGrid } from '@/components/visit-views';
import { api, isApiError } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** Operational visit details for staff; administrators can also cancel and open the approval view. */
export default function StaffVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const role = session?.role ?? null;
  const [passOpen, setPassOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const visit = useQuery({ queryKey: ['visit', id], queryFn: () => api<VisitDTO>(`/visits/${id}`) });
  const pass = useQuery({ queryKey: ['pass', 'staff', id], queryFn: () => api<PassDTO>(`/visits/${id}/pass`), enabled: passOpen, retry: false });
  const cancel = useMutation({
    mutationFn: () => api<VisitDTO>(`/visits/${id}/cancel`, { body: { reason: reason.trim() || undefined } }),
    onSuccess: (v) => {
      qc.setQueryData(['visit', id], v);
      setCancelOpen(false);
      toast(t('visitor.cancelled'));
    },
  });

  if (visit.isLoading) return <LoadingRows rows={8} />;
  if (visit.isError || !visit.data) return <ErrorState error={visit.error} onRetry={() => void visit.refetch()} />;
  const v = visit.data;

  return (
    <div>
      <PageHeader
        back={
          <Link href={hasPermission(role, 'visits.read_history') ? '/staff/visits' : '/staff'} className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
            <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
            {hasPermission(role, 'visits.read_history') ? t('admin.visitHistoryTitle') : t('nav.home')}
          </Link>
        }
        title={<span className="ltr-nums">{v.reference}</span>}
        actions={
          <>
            <StatusBadge status={v.status} overdue={v.isOverdue} />
            {v.status === 'pending' && hasPermission(role, 'visits.approve') && (
              <ButtonLink href={`/staff/requests/${v.id}`} variant="accent" icon={<ClipboardCheck className="size-4" aria-hidden />}>
                {t('admin.reviewTitle')}
              </ButtonLink>
            )}
            {v.status === 'checked_in' && (
              <ButtonLink href={`/staff/scan?action=exit&visit=${v.id}`} icon={<LogOut className="size-4 rtl:-scale-x-100" aria-hidden />}>
                {t('scan.confirmExit')}
              </ButtonLink>
            )}
            {v.hasActivePass && hasPermission(role, 'visits.view_pass') && (
              <Button variant="secondary" icon={<QrCode className="size-4" aria-hidden />} onClick={() => setPassOpen(true)}>
                {t('pass.title')}
              </Button>
            )}
            {v.canCancel && hasPermission(role, 'visits.modify') && (
              <ButtonLink href={`/staff/register?edit=${v.id}`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />}>
                {t('request.modifyTitle')}
              </ButtonLink>
            )}
            {v.canCancel && hasPermission(role, 'visits.cancel_any') && (
              <Button variant="danger" icon={<Ban className="size-4" aria-hidden />} onClick={() => setCancelOpen(true)}>
                {t('admin.cancelAsAdmin')}
              </Button>
            )}
          </>
        }
      />
      {v.isOverdue && (
        <Banner tone="danger" className="mb-5">
          {t('statusDescription.overdue')}
        </Banner>
      )}
      {v.supersededByVisitId && (
        <Banner tone="info" className="mb-5" action={<Link className="font-bold underline" href={`/staff/visits/${v.supersededByVisitId}`}>{t('request.viewReplacement')}</Link>}>
          {t('request.replacedNotice')}
        </Banner>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('admin.visitTimeline')} />
            <div className="p-5">
              <VisitProgress visit={v} />
            </div>
          </Card>
          <Card>
            <CardHeader title={t('scan.visitDetails')} />
            <div className="p-5">
              <VisitDetailsGrid visit={v} />
            </div>
          </Card>
        </div>
        {v.visitor && (
          <Card>
            <CardHeader
              title={t('request.visitorSection')}
              icon={<IdCard className="size-5" aria-hidden />}
              actions={
                hasPermission(role, 'visitors.read_full') ? (
                  <Link href={`/staff/visitors/${v.visitor.id}`} className="text-sm font-semibold text-teal-700 hover:underline">
                    {t('common.seeDetails')}
                  </Link>
                ) : undefined
              }
            />
            <div className="p-5">
              <VisitorIdentityGrid visitor={v.visitor} />
            </div>
          </Card>
        )}
      </div>

      <Dialog
        open={passOpen}
        onClose={() => setPassOpen(false)}
        title={t('pass.title')}
        footer={
          <Button variant="secondary" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>
            {t('common.print')}
          </Button>
        }
      >
        {pass.isLoading ? <LoadingRows rows={3} /> : pass.data ? <PassCard pass={pass.data} /> : <ErrorState error={pass.error} />}
      </Dialog>

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
              {t('admin.cancelAsAdmin')}
            </Button>
          </>
        }
      >
        {cancel.isError && <Banner tone="danger" className="mb-3">{isApiError(cancel.error) ? t.dynamic(cancel.error.messageKey) : t('errors.internal_error')}</Banner>}
        <Field label={t('fields.cancelReason')} optional>
          {(a) => <Textarea {...a} maxLength={500} placeholder={t('admin.cancelReasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Dialog>
    </div>
  );
}
