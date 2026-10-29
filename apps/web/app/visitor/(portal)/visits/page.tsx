'use client';

import { CalendarPlus, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Paginated, VisitDTO } from '@vms/shared';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { ButtonLink, Card, PageHeader } from '@/components/ui/primitives';
import { Pagination } from '@/components/ui/table';
import { VisitSummaryCard } from '@/components/visit-views';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function MyVisitsPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['my-visits', 'list', page], queryFn: () => api<Paginated<VisitDTO>>(`/me/visits?page=${page}&pageSize=10`), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader
        title={t('visitor.myVisits')}
        actions={
          <ButtonLink href="/visitor/request" variant="accent" icon={<CalendarPlus className="size-5" aria-hidden />}>
            {t('visitor.newRequest')}
          </ButtonLink>
        }
      />
      {q.isLoading ? (
        <LoadingRows rows={4} />
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState icon={<ListChecks className="size-7" aria-hidden />} title={t('visitor.historyEmpty')} hint={t('visitor.historyEmptyHint')} />
        </Card>
      ) : (
        <div className="space-y-3">
          {q.data.items.map((v) => (
            <VisitSummaryCard key={v.id} visit={v} href={`/visitor/visits/${v.id}`} />
          ))}
          <Card>
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={setPage} />
          </Card>
        </div>
      )}
    </div>
  );
}
