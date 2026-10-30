'use client';

import { CheckCheck, ClipboardCheck, ImageIcon, ImageOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ArrivalListItemDTO, ArrivalStatus } from '@vms/shared';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

const PAGE_SIZE = 25;

/** Arrivals registered without a verification code, waiting for an administrator to verify them. */
export default function ArrivalsPage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const router = useRouter();
  const [status, setStatus] = useState<ArrivalStatus>('pending');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['arrivals', status, page],
    queryFn: () => api<{ items: ArrivalListItemDTO[]; total: number; pendingCount: number }>(`/arrivals?status=${status}&page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  return (
    <div>
      <PageHeader title={t('arrivals.title')} subtitle={t('arrivals.subtitle')} />
      <Card>
        <div className="border-b border-line p-4">
          <Segmented
            label={t('fields.status')}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={(['pending', 'approved', 'rejected'] as const).map((s) => ({
              value: s,
              label: s === 'pending' && q.data?.pendingCount ? `${t(`arrivals.tabs.${s}`)} (${q.data.pendingCount})` : t(`arrivals.tabs.${s}`),
            }))}
          />
        </div>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<CheckCheck className="size-7" aria-hidden />} title={t('arrivals.empty')} hint={t('arrivals.emptyHint')} />
        ) : (
          <>
            <DataTable
              caption={t('arrivals.title')}
              rows={q.data.items}
              rowKey={(a) => a.id}
              onRowClick={(a) => router.push(`/staff/arrivals/${a.id}`)}
              columns={[
                { key: 'ref', header: t('arrival.reference'), cell: (a) => <span className="font-bold text-navy-800 ltr-nums">{a.reference}</span> },
                {
                  key: 'visitor',
                  header: t('fields.visitor'),
                  cell: (a) => (
                    <div>
                      <p className="font-semibold text-ink">{a.fullName ?? '—'}</p>
                      <p className="text-xs text-muted ltr-nums">{a.documentNumberMasked}</p>
                    </div>
                  ),
                },
                { key: 'villa', header: t('fields.villa'), cell: (a) => <span className="font-semibold ltr-nums">{a.villaNumber}</span> },
                {
                  key: 'kind',
                  header: <span className="sr-only">{t('fields.visitor')}</span>,
                  hideOnMobile: true,
                  cell: (a) => (
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={a.returningVisitor ? 'blue' : 'teal'}>{a.returningVisitor ? t('arrivals.returning') : t('arrivals.newVisitor')}</Badge>
                      <Badge tone={a.hasImage ? 'green' : 'amber'} icon={a.hasImage ? <ImageIcon className="size-3.5" aria-hidden /> : <ImageOff className="size-3.5" aria-hidden />}>
                        {a.hasImage ? t('arrivals.withImage') : t('arrivals.noImage')}
                      </Badge>
                    </div>
                  ),
                },
                { key: 'created', header: t('arrivals.submittedAt'), cell: (a) => <span className="whitespace-nowrap">{fmt.dateTime(a.createdAt)}</span> },
                { key: 'go', header: <span className="sr-only">{t('common.actions')}</span>, cell: () => <ClipboardCheck className="size-5 text-teal-700" aria-hidden /> },
              ]}
            />
            <Pagination page={page} totalPages={Math.max(1, Math.ceil(q.data.total / PAGE_SIZE))} total={q.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
