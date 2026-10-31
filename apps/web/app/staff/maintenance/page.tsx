'use client';

import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAINTENANCE_STATUSES, type MaintenanceDTO, type MaintenanceStatus } from '@vms/shared';
import { MAINTENANCE_TONE } from '@/components/maintenance';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Input, Segmented, Select } from '@/components/ui/form';
import { Badge, Button, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

function MaintenanceItem({ m }: { m: MaintenanceDTO }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<MaintenanceStatus>(m.status);
  const [note, setNote] = useState(m.adminNote ?? '');
  const save = useMutation({
    mutationFn: () => api(`/maintenance/${m.id}`, { method: 'PATCH', body: { status, adminNote: note.trim() || null } }),
    onSuccess: () => {
      toast(t('admin.saved'));
      void qc.invalidateQueries({ queryKey: ['maintenance'] });
    },
  });
  return (
    <li className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-extrabold text-navy-900 ltr-nums">{t('resident.villaHeader', { villa: m.villaNumber })}</span>
          <span className="font-semibold text-navy-800">{t(`resident.categories.${m.category}`)}</span>
          <span className="text-xs text-muted ltr-nums">{m.reference}</span>
        </div>
        <Badge tone={MAINTENANCE_TONE[m.status]}>{t(`resident.maintenanceStatus.${m.status}`)}</Badge>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{m.description}</p>
      <p className="mt-1 text-xs text-muted">{fmt.dateTime(m.createdAt)}</p>
      <div className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-[10rem_1fr_auto]">
        <Select aria-label={t('fields.status')} value={status} onChange={(e) => setStatus(e.target.value as MaintenanceStatus)}>
          {MAINTENANCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`resident.maintenanceStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Input aria-label={t('maintenanceAdmin.note')} placeholder={t('maintenanceAdmin.note')} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('maintenanceAdmin.update')}
        </Button>
      </div>
    </li>
  );
}

/** Maintenance requests from residents. */
export default function MaintenanceAdminPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<MaintenanceStatus | 'all'>('open');
  const q = useQuery({
    queryKey: ['maintenance', filter],
    queryFn: () => api<{ items: MaintenanceDTO[]; openCount: number }>(`/maintenance${filter === 'all' ? '' : `?status=${filter}`}`),
    refetchInterval: 60_000,
  });
  return (
    <div>
      <PageHeader title={t('maintenanceAdmin.title')} />
      <div className="mb-4 overflow-x-auto">
        <Segmented
          label={t('maintenanceAdmin.title')}
          value={filter}
          onChange={setFilter}
          options={[
            ...(['open', 'in_progress', 'done'] as const).map((s) => ({ value: s, label: `${t(`resident.maintenanceStatus.${s}`)}${s === 'open' && q.data?.openCount ? ` (${q.data.openCount})` : ''}` })),
            { value: 'all' as const, label: t('maintenanceAdmin.all') },
          ]}
        />
      </div>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<Wrench className="size-7" aria-hidden />} title={t('maintenanceAdmin.empty')} />
      ) : (
        <ul className="space-y-3">
          {q.data.items.map((m) => (
            <MaintenanceItem key={`${m.id}-${m.updatedAt}`} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
