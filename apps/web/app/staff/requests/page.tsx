'use client';

import { CheckCheck, ClipboardCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Paginated, VisitDTO } from '@vms/shared';
import { EMPTY_FILTERS, VisitFilters, filtersToQuery, type VisitFilterState } from '@/components/visit-filters';
import { StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/table';
import { useVisitLabels } from '@/components/visit-views';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** Administrator queue of requests waiting for a decision, soonest entry first. */
export default function RequestQueuePage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const router = useRouter();
  const [filters, setFilters] = useState<VisitFilterState>({ ...EMPTY_FILTERS, sort: 'entry_asc' });
  const [draft, setDraft] = useState(filters);
  const [page, setPage] = useState(1);
  const query = filtersToQuery({ ...filters, status: 'pending' }, page);
  const q = useQuery({ queryKey: ['queue', query], queryFn: () => api<Paginated<VisitDTO>>(`/visits?${query}`), placeholderData: keepPreviousData, refetchInterval: 15_000 });
  const apply = (f: VisitFilterState) => {
    setFilters(f);
    setDraft(f);
    setPage(1);
  };
  return (
    <div>
      <PageHeader title={t('admin.pendingQueue')} subtitle={q.data ? `${q.data.total} ${t('status.pending')}` : undefined} />
      <Card>
        <VisitFilters value={filters} draft={draft} onDraft={setDraft} onApply={apply} hideStatus />
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<CheckCheck className="size-7" aria-hidden />} title={t('admin.queueEmpty')} hint={t('admin.queueEmptyHint')} />
        ) : (
          <>
            <DataTable
              caption={t('admin.pendingQueue')}
              rows={q.data.items}
              rowKey={(v) => v.id}
              onRowClick={(v) => router.push(`/staff/requests/${v.id}`)}
              columns={[
                { key: 'ref', header: t('fields.reference'), cell: (v) => <span className="font-bold text-navy-800 ltr-nums">{v.reference}</span> },
                {
                  key: 'visitor',
                  header: t('fields.visitor'),
                  cell: (v) => (
                    <div>
                      <p className="font-semibold text-ink">{v.visitor?.fullName}</p>
                      <p className="text-xs text-muted ltr-nums">{v.visitor?.documentNumberMasked}</p>
                    </div>
                  ),
                },
                { key: 'villa', header: t('fields.villa'), cell: (v) => <span className="font-semibold ltr-nums">{v.villa.number}</span> },
                { key: 'reason', header: t('fields.reason'), cell: (v) => labels.reason(v), hideOnMobile: true },
                { key: 'entry', header: t('fields.entryAt'), cell: (v) => <span className="whitespace-nowrap">{fmt.dateTime(v.requestedEntryAt)}</span> },
                {
                  key: 'submitted',
                  header: t('fields.submittedBy'),
                  hideOnMobile: true,
                  cell: (v) => (
                    <div className="text-sm">
                      <p>{labels.actor(v.submittedBy)}</p>
                      <p className="text-xs text-muted">{fmt.dateTime(v.submittedAt)}</p>
                    </div>
                  ),
                },
                { key: 'status', header: t('fields.status'), cell: (v) => <StatusBadge status={v.status} /> },
                { key: 'go', header: <span className="sr-only">{t('common.actions')}</span>, cell: () => <ClipboardCheck className="size-5 text-teal-700" aria-hidden /> },
              ]}
            />
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
