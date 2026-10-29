'use client';

import { Building2, Pencil, Plus, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldErrorsFromIssues, villaSchema, type Paginated, type VillaDTO } from '@vms/shared';
import { Dialog } from '@/components/ui/dialog';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Input, Switch } from '@/components/ui/form';
import { Badge, Button, Card, PageHeader } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function VillaDialog({ villa, onClose }: { villa: VillaDTO | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ number: villa?.number ?? '', label: villa?.label ?? '', isActive: villa?.isActive ?? true });
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { number: form.number, label: form.label.trim() || null, isActive: form.isActive };
      return villa ? api<VillaDTO>(`/villas/${villa.id}`, { method: 'PATCH', body }) : api<VillaDTO>('/villas', { body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['villas'] });
      void qc.invalidateQueries({ queryKey: ['villa-options'] });
      toast(t('admin.saved'));
      onClose();
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={villa ? t('admin.editVilla') : t('admin.addVilla')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              const parsed = villaSchema.safeParse({ ...form, label: form.label || null });
              if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
              setFields({});
              save.mutate();
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
        <Field label={t('fields.villaNumber')} required error={fields.number}>
          {(a) => <Input {...a} dir="ltr" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />}
        </Field>
        <Field label={t('fields.villaLabel')} error={fields.label}>
          {(a) => <Input {...a} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />}
        </Field>
        <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label={t('common.active')} />
      </div>
    </Dialog>
  );
}

export default function VillasPage() {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ villa: VillaDTO | null } | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: '50', ...(q ? { q } : {}) }).toString();
  const list = useQuery({ queryKey: ['villas', params], queryFn: () => api<Paginated<VillaDTO>>(`/villas?${params}`), placeholderData: keepPreviousData });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(draft.trim());
    setPage(1);
  };
  return (
    <div>
      <PageHeader
        title={t('admin.villasTitle')}
        actions={
          <Button variant="accent" icon={<Plus className="size-5" aria-hidden />} onClick={() => setDialog({ villa: null })}>
            {t('admin.addVilla')}
          </Button>
        }
      />
      <Card>
        <form role="search" onSubmit={submit} className="flex gap-2 border-b border-line p-4">
          <Input aria-label={t('request.searchVilla')} placeholder={t('request.searchVilla')} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" icon={<Search className="size-4" aria-hidden />}>
            {t('common.search')}
          </Button>
        </form>
        {list.isLoading ? (
          <LoadingRows />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data?.items.length ? (
          <EmptyState icon={<Building2 className="size-7" aria-hidden />} title={t('common.noResults')} />
        ) : (
          <>
            <DataTable
              caption={t('admin.villasTitle')}
              rows={list.data.items}
              rowKey={(v) => v.id}
              columns={[
                { key: 'number', header: t('fields.villaNumber'), cell: (v) => <span className="font-bold ltr-nums">{v.number}</span> },
                { key: 'label', header: t('fields.villaLabel'), cell: (v) => v.label ?? '—' },
                { key: 'status', header: t('fields.status'), cell: (v) => <Badge tone={v.isActive ? 'green' : 'neutral'}>{v.isActive ? t('common.active') : t('common.inactive')}</Badge> },
                {
                  key: 'edit',
                  header: <span className="sr-only">{t('common.actions')}</span>,
                  cell: (v) => (
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setDialog({ villa: v })}>
                      {t('common.edit')}
                    </Button>
                  ),
                },
              ]}
            />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
      {dialog && <VillaDialog villa={dialog.villa} onClose={() => setDialog(null)} />}
    </div>
  );
}
