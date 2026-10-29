'use client';

import { AlertTriangle, DoorOpen, LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { VisitDTO } from '@vms/shared';
import { OverdueBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { Badge, ButtonLink, Card, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { useVisitLabels } from '@/components/visit-views';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** Current occupancy. Overdue visitors stay listed (flagged) until staff explicitly record their exit. */
export default function InsidePage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const [filter, setFilter] = useState<'all' | 'overdue'>('all');
  const q = useQuery({ queryKey: ['inside'], queryFn: () => api<{ items: VisitDTO[] }>('/visits/inside'), refetchInterval: 20_000 });
  const rows = useMemo(() => {
    const items = q.data?.items ?? [];
    const sorted = [...items].sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue));
    return filter === 'overdue' ? sorted.filter((v) => v.isOverdue) : sorted;
  }, [q.data, filter]);
  const overdueCount = q.data?.items.filter((v) => v.isOverdue).length ?? 0;

  return (
    <div>
      <PageHeader
        title={t('admin.insideTitle')}
        subtitle={q.data ? `${t('common.total')}: ${q.data.items.length}` : undefined}
        actions={
          overdueCount > 0 ? (
            <Badge tone="red" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
              {overdueCount} {t('status.overdue')}
            </Badge>
          ) : undefined
        }
      />
      <Card>
        <div className="border-b border-line p-4">
          <Segmented
            className="max-w-sm"
            label={t('common.filter')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('common.all') },
              { value: 'overdue', label: t('status.overdue') },
            ]}
          />
        </div>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !rows.length ? (
          <EmptyState icon={<DoorOpen className="size-7" aria-hidden />} title={t('admin.insideEmpty')} />
        ) : (
          <DataTable
            caption={t('admin.insideTitle')}
            rows={rows}
            rowKey={(v) => v.id}
            columns={[
              {
                key: 'visitor',
                header: t('fields.visitor'),
                cell: (v) => (
                  <div>
                    <p className="font-semibold">{v.visitor?.fullName}</p>
                    <p className="text-xs text-muted ltr-nums">
                      {v.visitor?.documentNumberMasked} · {v.reference}
                    </p>
                  </div>
                ),
              },
              { key: 'villa', header: t('fields.villa'), cell: (v) => <span className="font-semibold ltr-nums">{v.villa.number}</span> },
              { key: 'reason', header: t('fields.reason'), cell: (v) => labels.reason(v), hideOnMobile: true },
              { key: 'since', header: t('fields.insideSince'), cell: (v) => <span className="whitespace-nowrap">{fmt.dateTime(v.checkedInAt)}</span> },
              { key: 'gate', header: t('fields.entryGate'), cell: (v) => labels.gate(v.checkInGate), hideOnMobile: true },
              {
                key: 'exit',
                header: t('fields.expectedExit'),
                cell: (v) => (
                  <div className="flex flex-col items-start gap-1">
                    <span className={v.isOverdue ? 'font-bold text-red-700' : ''}>{fmt.dateTime(v.expectedExitAt)}</span>
                    {v.isOverdue && <OverdueBadge />}
                  </div>
                ),
              },
              {
                key: 'action',
                header: <span className="sr-only">{t('common.actions')}</span>,
                cell: (v) => (
                  <ButtonLink href={`/staff/scan?action=exit&visit=${v.id}`} size="sm" variant="secondary" icon={<LogOut className="size-4 rtl:-scale-x-100" aria-hidden />}>
                    {t('scan.exit')}
                  </ButtonLink>
                ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
