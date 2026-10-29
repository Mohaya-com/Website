'use client';

import { LogIn, LogOut, ScrollText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { GateEventDTO, Paginated } from '@vms/shared';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/table';
import { useGates } from '@/components/visit-filters';
import { useVisitLabels } from '@/components/visit-views';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** Entry/exit movement log (operational view for gate staff). */
export default function GateLogPage() {
  const { t, locale } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const router = useRouter();
  const gates = useGates();
  const [f, setF] = useState({ gateId: '', type: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '25', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const q = useQuery({ queryKey: ['gate-events', params], queryFn: () => api<Paginated<GateEventDTO>>(`/gate-events?${params}`), placeholderData: keepPreviousData });
  const update = (patch: Partial<typeof f>) => {
    setF({ ...f, ...patch });
    setPage(1);
  };
  return (
    <div>
      <PageHeader title={t('security.logTitle')} subtitle={t('security.logSubtitle')} />
      <Card>
        <div className="grid grid-cols-2 gap-2 border-b border-line p-4 md:grid-cols-4">
          <Select aria-label={t('fields.gate')} value={f.gateId} onChange={(e) => update({ gateId: e.target.value })}>
            <option value="">{`${t('fields.gate')}: ${t('common.all')}`}</option>
            {gates.data?.items.map((g) => (
              <option key={g.id} value={g.id}>
                {locale === 'ar' ? g.nameAr : g.nameEn}
              </option>
            ))}
          </Select>
          <Select aria-label={t('fields.action')} value={f.type} onChange={(e) => update({ type: e.target.value })}>
            <option value="">{`${t('fields.action')}: ${t('common.all')}`}</option>
            <option value="entry">{t('scan.entry')}</option>
            <option value="exit">{t('scan.exit')}</option>
          </Select>
          <Input type="date" aria-label={t('fields.dateFrom')} value={f.from} onChange={(e) => update({ from: e.target.value })} />
          <Input type="date" aria-label={t('fields.dateTo')} value={f.to} onChange={(e) => update({ to: e.target.value })} />
        </div>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<ScrollText className="size-7" aria-hidden />} title={t('security.logEmpty')} />
        ) : (
          <>
            <DataTable
              caption={t('security.logTitle')}
              rows={q.data.items}
              rowKey={(e) => e.id}
              onRowClick={(e) => router.push(`/staff/visits/${e.visit.id}`)}
              columns={[
                { key: 'time', header: t('fields.occurredAt'), cell: (e) => <span className="whitespace-nowrap">{fmt.dateTime(e.recordedAt)}</span> },
                {
                  key: 'type',
                  header: t('fields.action'),
                  cell: (e) =>
                    e.type === 'entry' ? (
                      <Badge tone="green" icon={<LogIn className="size-3.5 rtl:-scale-x-100" aria-hidden />}>
                        {t('scan.entry')}
                      </Badge>
                    ) : (
                      <Badge tone="slate" icon={<LogOut className="size-3.5 rtl:-scale-x-100" aria-hidden />}>
                        {t('scan.exit')}
                      </Badge>
                    ),
                },
                {
                  key: 'visitor',
                  header: t('fields.visitor'),
                  cell: (e) => (
                    <div>
                      <p className="font-semibold">{e.visit.visitorName}</p>
                      <p className="text-xs text-muted ltr-nums">
                        {e.visit.documentNumberMasked} · {e.visit.reference}
                      </p>
                    </div>
                  ),
                },
                { key: 'villa', header: t('fields.villa'), cell: (e) => <span className="font-semibold ltr-nums">{e.visit.villaNumber}</span> },
                { key: 'gate', header: t('fields.gate'), cell: (e) => labels.gate(e.gate) },
                { key: 'by', header: t('fields.recordedBy'), cell: (e) => labels.actor(e.recordedBy), hideOnMobile: true },
                { key: 'method', header: t('fields.method'), cell: (e) => (e.method === 'qr' ? 'QR' : t('scan.manualLookup')), hideOnMobile: true },
              ]}
            />
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
