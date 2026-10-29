'use client';

import { AlertTriangle, ArrowRight, Check, History, IdCard, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VisitDTO, VisitReviewDTO } from '@vms/shared';
import { DocumentStatusBadge, StatusBadge } from '@/components/status';
import { Dialog } from '@/components/ui/dialog';
import { Banner, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { Badge, Button, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { VisitHistoryTimeline } from '@/components/visit-history';
import { VisitDetailsGrid, VisitorIdentityGrid } from '@/components/visit-views';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** Approval detail: identity, document status, request details and complete prior history before deciding. */
export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const review = useQuery({ queryKey: ['review', id], queryFn: () => api<VisitReviewDTO>(`/visits/${id}/review`) });

  const onDecided = (v: VisitDTO, message: string) => {
    toast(message);
    void qc.invalidateQueries({ queryKey: ['queue'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['review', id] });
    setApproveOpen(false);
    setRejectOpen(false);
    router.push(v.status === 'approved' || v.status === 'rejected' ? '/staff/requests' : `/staff/requests/${id}`);
  };
  const approve = useMutation({
    mutationFn: () => api<VisitDTO>(`/visits/${id}/approve`, { body: { expectedVersion: review.data?.visit.version } }),
    onSuccess: (v) => onDecided(v, t('admin.approvedToast')),
  });
  const reject = useMutation({
    mutationFn: () => api<VisitDTO>(`/visits/${id}/reject`, { body: { reason: reason.trim(), expectedVersion: review.data?.visit.version } }),
    onSuccess: (v) => onDecided(v, t('admin.rejectedToast')),
    onError: (err) => {
      if (isApiError(err) && err.fields.reason) setReasonError(err.fields.reason);
    },
  });

  if (review.isLoading) return <LoadingRows rows={8} />;
  if (review.isError || !review.data) return <ErrorState error={review.error} onRetry={() => void review.refetch()} />;
  const { visit, visitor, identity, history, stats } = review.data;
  const decisionError = approve.error ?? reject.error;

  return (
    <div>
      <PageHeader
        back={
          <Link href="/staff/requests" className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
            <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
            {t('admin.pendingQueue')}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t('admin.reviewTitle')} <span className="text-navy-600 ltr-nums">{visit.reference}</span>
          </span>
        }
        actions={<StatusBadge status={visit.status} overdue={visit.isOverdue} />}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title={t('request.visitorSection')}
              icon={<IdCard className="size-5" aria-hidden />}
              actions={
                <Link href={`/staff/visitors/${visitor.id}`} className="text-sm font-semibold text-teal-700 hover:underline">
                  {t('common.seeDetails')}
                </Link>
              }
            />
            <div className="space-y-4 p-5">
              <VisitorIdentityGrid visitor={visitor} />
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                <span className="text-sm font-semibold text-muted">{t('admin.identityStatus')}:</span>
                {identity.expired ? (
                  <DocumentStatusBadge expired />
                ) : !identity.validOnVisitDate ? (
                  <DocumentStatusBadge expired label={t('admin.identityInvalidOnVisit')} />
                ) : (
                  <DocumentStatusBadge expired={false} />
                )}
                {!identity.expired && identity.daysUntilExpiry <= 30 && (
                  <Badge tone="amber" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
                    {t('admin.identityExpiresInDays', { days: identity.daysUntilExpiry })}
                  </Badge>
                )}
              </div>
              {review.data.profileChangedSinceSubmission && (
                <Banner tone="warning" title={t('admin.profileVersions')}>
                  {t('admin.profileEditHint')}
                </Banner>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={t('scan.visitDetails')} />
            <div className="p-5">
              <VisitDetailsGrid visit={visit} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-20">
            <CardHeader title={t('fields.status')} />
            <div className="space-y-4 p-5">
              {visit.status !== 'pending' ? (
                <Banner tone="info" title={t('admin.decisionMade')}>
                  {t(`statusDescription.${visit.status}`)}
                </Banner>
              ) : review.data.approvalBlockedReason ? (
                <Banner tone="danger" icon={<ShieldAlert className="size-5" aria-hidden />} title={t('admin.approvalBlocked')}>
                  {t.dynamic(review.data.approvalBlockedReason)}
                </Banner>
              ) : null}
              {decisionError && <Banner tone="danger">{isApiError(decisionError) ? t.dynamic(decisionError.messageKey) : t('errors.internal_error')}</Banner>}
              {visit.status === 'pending' && (
                <div className="grid grid-cols-2 gap-3">
                  <Button size="lg" variant="success" disabled={!review.data.canDecide} onClick={() => setApproveOpen(true)} icon={<Check className="size-5" aria-hidden />}>
                    {t('admin.approve')}
                  </Button>
                  <Button size="lg" variant="danger" onClick={() => setRejectOpen(true)} icon={<X className="size-5" aria-hidden />}>
                    {t('admin.reject')}
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={t('admin.previousVisits')} icon={<History className="size-5" aria-hidden />} />
            <VisitHistoryTimeline visits={history} stats={stats} />
          </Card>
        </div>
      </div>

      <Dialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={t('admin.approveConfirmTitle')}
        description={t('admin.approveConfirmBody')}
        icon={<span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Check className="size-5" aria-hidden /></span>}
        footer={
          <>
            <Button variant="secondary" onClick={() => setApproveOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="success" loading={approve.isPending} onClick={() => approve.mutate()}>
              {t('admin.approve')}
            </Button>
          </>
        }
      />

      <Dialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('admin.rejectTitle')}
        icon={<span className="grid size-10 place-items-center rounded-xl bg-red-50 text-red-700"><X className="size-5" aria-hidden /></span>}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={reject.isPending}
              onClick={() => {
                if (reason.trim().length < 3) {
                  setReasonError('validation.reasonLength');
                  return;
                }
                setReasonError(null);
                reject.mutate();
              }}
            >
              {t('admin.reject')}
            </Button>
          </>
        }
      >
        <Field label={t('fields.rejectionReason')} required error={reasonError}>
          {(a) => <Textarea {...a} autoFocus maxLength={500} placeholder={t('admin.rejectReasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Dialog>
    </div>
  );
}
