'use client';

import { Send, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAINTENANCE_CATEGORIES, fieldErrorsFromIssues, maintenanceCreateSchema, type MaintenanceCategory, type MaintenanceDTO } from '@vms/shared';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Select, Textarea } from '@/components/ui/form';
import { MAINTENANCE_TONE } from '@/components/maintenance';
import { Badge, Button, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** Residents raise maintenance requests and follow their status. */
export default function MaintenancePage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [category, setCategory] = useState<MaintenanceCategory | ''>('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ['resident', 'maintenance'], queryFn: () => api<{ items: MaintenanceDTO[] }>('/resident/maintenance') });
  const create = useMutation({
    mutationFn: (body: unknown) => api<MaintenanceDTO>('/resident/maintenance', { body }),
    onSuccess: () => {
      toast(t('resident.requestSent'));
      setCategory('');
      setDescription('');
      void qc.invalidateQueries({ queryKey: ['resident', 'maintenance'] });
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/resident/maintenance/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['resident', 'maintenance'] }),
  });

  function submit() {
    const body = { category: category || undefined, description };
    const parsed = maintenanceCreateSchema.safeParse(body);
    if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
    setFields({});
    create.mutate(body);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('resident.maintenanceTitle')} />
      <Card>
        <CardHeader title={t('resident.newRequest')} icon={<Wrench className="size-5" aria-hidden />} />
        <div className="space-y-4 p-5">
          <Field label={t('resident.category')} required error={fields.category}>
            {(a) => (
              <Select {...a} value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}>
                <option value="">{t('common.select')}</option>
                {MAINTENANCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`resident.categories.${c}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('resident.description')} required error={fields.description}>
            {(a) => <Textarea {...a} rows={4} maxLength={1000} placeholder={t('resident.descriptionPlaceholder')} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          {create.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(create.error) ? t.dynamic(create.error.messageKey) : t('errors.internal_error')}</Banner>}
          <div className="flex justify-end">
            <Button variant="accent" loading={create.isPending} icon={<Send className="size-4 rtl:-scale-x-100" aria-hidden />} onClick={submit}>
              {t('resident.submitRequest')}
            </Button>
          </div>
        </div>
      </Card>
      {list.isLoading ? (
        <LoadingRows />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState icon={<Wrench className="size-7" aria-hidden />} title={t('resident.noRequests')} />
      ) : (
        <ul className="space-y-3">
          {list.data.items.map((m) => (
            <li key={m.id} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-navy-900">{t(`resident.categories.${m.category}`)}</span>
                  <span className="text-xs text-muted ltr-nums">{m.reference}</span>
                </div>
                <Badge tone={MAINTENANCE_TONE[m.status]}>{t(`resident.maintenanceStatus.${m.status}`)}</Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{m.description}</p>
              {m.adminNote && <p className="mt-2 rounded-lg bg-navy-50 p-2 text-sm text-navy-800">{t('resident.adminNote', { note: m.adminNote })}</p>}
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
                <span>{fmt.dateTime(m.createdAt)}</span>
                {m.status === 'open' && (
                  <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden />} loading={cancel.isPending && cancel.variables === m.id} onClick={() => cancel.mutate(m.id)}>
                    {t('resident.cancelRequest')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
