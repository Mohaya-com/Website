'use client';

import { History } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Paginated, VisitDTO } from '@vms/shared';
import { StatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Card, PageHeader } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/table';
import { EMPTY_FILTERS, VisitFilters, filtersToQuery, type VisitFilterState } from '@/components/visit-filters';
import { useVisitLabels } from '@/components/visit-views';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

function VisitHistory() {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const router = useRouter();
  const search = useSearchParams();
  const initial = { ...EMPTY_FILTERS, status: search.get('status') ?? '', q: search.get('q') ?? '' };
  const [filters, setFilters] = useState<VisitFilterState>(initial);
  const [draft, setDraft] = useState(initial);
  const [page, setPage] = useState(1);
  const query = filtersToQuery(filters, page);
  const q = useQuery({ queryKey: ['visits', query], queryFn: () => api<Paginated<VisitDTO>>(`/visits?${query}`), placeholderData: keepPreviousData });
  const apply = (f: VisitFilterState) => {
    setFilters(f);
    setDraft(f);
    setPage(1);
  };
  return (
    <div>
      <PageHeader title={t('admin.visitHistoryTitle')} subtitle={q.data ? `${t('common.total')}: ${q.data.total}` : undefined} />
      <Card>
        <VisitFilters value={filters} draft={draft} onDraft={setDraft} onApply={apply} />
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<History className="size-7" aria-hidden />} title={t('common.noResults')} hint={t('common.noResultsHint')} />
        ) : (
          <>
            <DataTable
              caption={t('admin.visitHistoryTitle')}
              rows={q.data.items}
              rowKey={(v) => v.id}
              onRowClick={(v) => router.push(v.status === 'pending' ? `/staff/requests/${v.id}` : `/staff/visits/${v.id}`)}
              columns={[
                { key: 'ref', header: t('fields.reference'), cell: (v) => <span className="font-bold text-navy-800 ltr-nums">{v.reference}</span> },
                {
                  key: 'visitor',
                  header: t('fields.visitor'),
                  cell: (v) => (
                    <div>
                      <p className="font-semibold">{v.visitor?.fullName}</p>
                      <p className="text-xs text-muted ltr-nums">{v.visitor?.documentNumberMasked}</p>
                    </div>
                  ),
                },
                { key: 'villa', header: t('fields.villa'), cell: (v) => <span className="font-semibold ltr-nums">{v.villa.number}</span> },
                { key: 'reason', header: t('fields.reason'), cell: (v) => labels.reason(v), hideOnMobile: true },
                { key: 'entry', header: t('fields.entryAt'), cell: (v) => <span className="whitespace-nowrap">{fmt.dateTime(v.requestedEntryAt)}</span> },
                {
                  key: 'actual',
                  header: `${t('fields.actualEntry')} / ${t('fields.actualExit')}`,
                  hideOnMobile: true,
                  cell: (v) => (
                    <div className="whitespace-nowrap text-sm">
                      <p>{v.checkedInAt ? `${fmt.time(v.checkedInAt)} · ${labels.gate(v.checkInGate)}` : '—'}</p>
                      <p className="text-muted">{v.checkedOutAt ? `${fmt.time(v.checkedOutAt)} · ${labels.gate(v.checkOutGate)}` : '—'}</p>
                    </div>
                  ),
                },
                { key: 'status', header: t('fields.status'), cell: (v) => <StatusBadge status={v.status} overdue={v.isOverdue} /> },
              ]}
            />
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

export default function VisitHistoryPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <VisitHistory />
    </Suspense>
  );
}
