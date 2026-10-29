'use client';

import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditDTO, Paginated } from '@vms/shared';
import { ar } from '@vms/shared';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

const ACTIONS = Object.keys(ar.audit.actions);
const ENTITIES = Object.keys(ar.audit.entityTypes);

function Metadata({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (!entries.length) return <span className="text-muted">—</span>;
  return (
    <dl className="max-w-md space-y-0.5 text-xs">
      {entries.slice(0, 6).map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <dt className="shrink-0 font-semibold text-muted">{k}:</dt>
          <dd className="truncate text-ink" dir="ltr" title={typeof v === 'string' ? v : JSON.stringify(v)}>
            {typeof v === 'string' ? v : JSON.stringify(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Append-only audit trail (administrators only). Records never contain raw identity numbers. */
export default function AuditPage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const [f, setF] = useState({ action: '', entityType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '30', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const q = useQuery({ queryKey: ['audit', params], queryFn: () => api<Paginated<AuditDTO>>(`/audit?${params}`), placeholderData: keepPreviousData });
  const update = (patch: Partial<typeof f>) => {
    setF({ ...f, ...patch });
    setPage(1);
  };
  return (
    <div>
      <PageHeader title={t('admin.auditTitle')} subtitle={t('admin.auditSubtitle')} />
      <Card>
        <div className="grid grid-cols-2 gap-2 border-b border-line p-4 md:grid-cols-4">
          <Select aria-label={t('audit.filters.action')} value={f.action} onChange={(e) => update({ action: e.target.value })}>
            <option value="">{`${t('audit.filters.action')}: ${t('common.all')}`}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t.dynamic(`audit.actions.${a}`)}
              </option>
            ))}
          </Select>
          <Select aria-label={t('audit.filters.entity')} value={f.entityType} onChange={(e) => update({ entityType: e.target.value })}>
            <option value="">{`${t('audit.filters.entity')}: ${t('common.all')}`}</option>
            {ENTITIES.map((a) => (
              <option key={a} value={a}>
                {t.dynamic(`audit.entityTypes.${a}`)}
              </option>
            ))}
          </Select>
          <Input type="date" aria-label={t('fields.dateFrom')} value={f.from} onChange={(e) => update({ from: e.target.value })} />
          <Input type="date" aria-label={t('fields.dateTo')} value={f.to} onChange={(e) => update({ to: e.target.value })} />
        </div>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<KeyRound className="size-7" aria-hidden />} title={t('audit.empty')} />
        ) : (
          <>
            <DataTable
              caption={t('admin.auditTitle')}
              rows={q.data.items}
              rowKey={(a) => a.id}
              columns={[
                { key: 'time', header: t('fields.occurredAt'), cell: (a) => <span className="whitespace-nowrap text-sm">{fmt.dateTime(a.occurredAt)}</span> },
                {
                  key: 'actor',
                  header: t('fields.actor'),
                  cell: (a) => (
                    <div className="text-sm">
                      <p className="font-semibold">{a.actor.name ?? (a.actor.type === 'system' ? t('common.system') : '—')}</p>
                      <p className="text-xs text-muted">{a.actor.type === 'user' ? t('common.staff') : a.actor.type === 'visitor' ? t('common.visitorSelf') : t('common.system')}</p>
                    </div>
                  ),
                },
                { key: 'action', header: t('fields.action'), cell: (a) => <Badge tone={a.action.includes('failed') || a.action.includes('rejected') ? 'red' : 'navy'}>{t.has(`audit.actions.${a.action}`) ? t.dynamic(`audit.actions.${a.action}`) : a.action}</Badge> },
                { key: 'entity', header: t('fields.entity'), cell: (a) => t.dynamic(`audit.entityTypes.${a.entityType}`), hideOnMobile: true },
                { key: 'meta', header: t('audit.metadata'), cell: (a) => <Metadata data={a.metadata} />, hideOnMobile: true },
              ]}
            />
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
