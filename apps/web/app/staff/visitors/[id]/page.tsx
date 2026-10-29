'use client';

import { ArrowRight, FileClock, History, IdCard, Pencil, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { VisitDTO, VisitorFullDTO, VisitorVersionDTO } from '@vms/shared';
import { DocumentStatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Badge, Button, ButtonLink, Card, CardHeader, DetailItem, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { VisitHistoryTimeline } from '@/components/visit-history';
import { VisitorEditDialog } from '@/components/visitor-edit-dialog';
import { useVisitLabels } from '@/components/visit-views';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

const FIELD_LABELS: Record<string, string> = {
  fullName: 'fields.fullName',
  documentNumber: 'fields.documentNumber',
  documentExpiry: 'fields.documentExpiry',
  nationality: 'fields.nationality',
  mobile: 'fields.mobile',
  created: 'visitor.registered',
};

export default function VisitorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const qc = useQueryClient();
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const visitor = useQuery({ queryKey: ['visitor', id], queryFn: () => api<VisitorFullDTO>(`/visitors/${id}`) });
  const visits = useQuery({ queryKey: ['visitor', id, 'visits'], queryFn: () => api<{ items: VisitDTO[] }>(`/visitors/${id}/visits`) });
  const versions = useQuery({ queryKey: ['visitor', id, 'versions'], queryFn: () => api<{ items: VisitorVersionDTO[] }>(`/visitors/${id}/versions`) });

  if (visitor.isLoading) return <LoadingRows rows={6} />;
  if (visitor.isError || !visitor.data) return <ErrorState error={visitor.error} onRetry={() => void visitor.refetch()} />;
  const v = visitor.data;
  const chronological = [...(visits.data?.items ?? [])].reverse();

  return (
    <div>
      <PageHeader
        back={
          <Link href="/staff/visitors" className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
            <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
            {t('admin.visitorsTitle')}
          </Link>
        }
        title={v.fullName}
        subtitle={`${t(`documentTypes.${v.documentType}`)} · ${labels.nationality(v.nationality)}`}
        actions={
          <>
            <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditOpen(true)}>
              {t('returning.editProfile')}
            </Button>
            <ButtonLink href="/staff/register" variant="accent" icon={<UserPlus className="size-4" aria-hidden />}>
              {t('visitor.newRequest')}
            </ButtonLink>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('visitor.profileTitle')} icon={<IdCard className="size-5" aria-hidden />} />
            <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <DetailItem className="sm:col-span-2" label={t('fields.fullName')} value={v.fullName} />
              <DetailItem label={t('fields.documentType')} value={t(`documentTypes.${v.documentType}`)} />
              <DetailItem label={t('fields.documentNumber')} value={v.documentNumber} mono />
              <DetailItem label={t('fields.nationality')} value={labels.nationality(v.nationality)} />
              <DetailItem label={t('fields.mobile')} value={v.mobile} mono />
              <DetailItem
                className="sm:col-span-2"
                label={t('fields.documentExpiry')}
                value={
                  <span className="flex flex-wrap items-center gap-2">
                    {fmt.ymd(v.documentExpiryDate)}
                    {v.documentExpiryCalendar === 'hijri' && <span className="text-xs font-normal text-muted ltr-nums">({v.documentExpiryOriginal} {t('calendars.hijriShort')})</span>}
                    <DocumentStatusBadge expired={v.documentExpired} />
                  </span>
                }
              />
              <DetailItem label={t('fields.visitsCount')} value={v.visitCount} mono />
              <DetailItem label={t('fields.createdAt')} value={`${fmt.date(v.createdAt)} · ${v.createdVia === 'self' ? t('common.visitorSelf') : t('common.staff')}`} />
            </dl>
          </Card>
          <Card>
            <CardHeader title={t('admin.profileVersions')} icon={<FileClock className="size-5" aria-hidden />} />
            {versions.isLoading ? (
              <LoadingRows rows={2} />
            ) : !versions.data?.items.length ? (
              <EmptyState title={t('common.none')} />
            ) : (
              <ol className="divide-y divide-line">
                {[...versions.data.items].reverse().map((ver) => (
                  <li key={ver.version} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-navy-900 ltr-nums">v{ver.version}</span>
                      <span className="text-xs text-muted">{fmt.dateTime(ver.createdAt)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {ver.changedFields.map((f) => (
                        <Badge key={f} tone="navy">
                          {t.dynamic(FIELD_LABELS[f] ?? f)}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1.5 text-sm text-muted">
                      {labels.actor(ver.changedBy)}
                      {ver.changeReason && ver.changeReason !== 'self_service_renewal' ? ` — ${ver.changeReason}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title={t('admin.visitHistoryTitle')} icon={<History className="size-5" aria-hidden />} />
          {visits.isLoading ? <LoadingRows rows={4} /> : <VisitHistoryTimeline visits={chronological} />}
        </Card>
      </div>
      <VisitorEditDialog
        key={v.version}
        visitor={v}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          qc.setQueryData(['visitor', id], updated);
          void qc.invalidateQueries({ queryKey: ['visitor', id, 'versions'] });
          setEditOpen(false);
          toast(t('admin.profileUpdated'));
        }}
      />
    </div>
  );
}
