'use client';

import { Check, KeyRound, Trash2, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldErrorsFromIssues, residentPasswordResetSchema, type ResidentAdminDTO } from '@vms/shared';
import { Dialog } from '@/components/ui/dialog';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Input, Segmented } from '@/components/ui/form';
import { Badge, Button, Card, PageHeader, type Tone } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

const TONE: Record<ResidentAdminDTO['status'], Tone> = { pending: 'amber', active: 'green', rejected: 'red', disabled: 'slate' };

/** Villa accounts: approve first sign-ups, disable, reset the password or delete to free the villa. */
export default function ResidentsAdminPage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'active' | 'all'>('pending');
  const [resetFor, setResetFor] = useState<ResidentAdminDTO | null>(null);
  const [removeFor, setRemoveFor] = useState<ResidentAdminDTO | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['residents', tab],
    queryFn: () => api<{ items: ResidentAdminDTO[]; pendingCount: number }>(`/residents${tab === 'all' ? '' : `?status=${tab}`}`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['residents'] });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'disable' | 'enable' }) => api(`/residents/${id}/decision`, { body: { action } }),
    onSuccess: () => {
      toast(t('admin.saved'));
      refresh();
    },
  });
  const reset = useMutation({
    mutationFn: () => api(`/residents/${resetFor!.id}/password`, { body: { password } }),
    onSuccess: () => {
      toast(t('admin.saved'));
      setResetFor(null);
      setPassword('');
    },
    onError: (err) => isApiError(err) && setPasswordError(err.fields.password ?? err.messageKey),
  });
  const remove = useMutation({
    mutationFn: () => api(`/residents/${removeFor!.id}`, { method: 'DELETE', body: {} }),
    onSuccess: () => {
      toast(t('admin.saved'));
      setRemoveFor(null);
      refresh();
    },
  });

  return (
    <div>
      <PageHeader title={t('residentsAdmin.title')} subtitle={t('residentsAdmin.subtitle')} />
      <div className="mb-4">
        <Segmented
          label={t('residentsAdmin.title')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pending', label: `${t('residentsAdmin.tabs.pending')}${q.data?.pendingCount ? ` (${q.data.pendingCount})` : ''}` },
            { value: 'active', label: t('residentsAdmin.tabs.active') },
            { value: 'all', label: t('residentsAdmin.tabs.all') },
          ]}
        />
      </div>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState icon={<Users className="size-7" aria-hidden />} title={t('residentsAdmin.empty')} />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {q.data.items.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-extrabold text-navy-900 ltr-nums">{t('resident.villaHeader', { villa: r.villaNumber })}</p>
                  <p className="text-sm text-ink">{r.fullName ?? '—'}</p>
                  {r.mobile && (
                    <a href={`tel:${r.mobile}`} dir="ltr" className="text-sm text-teal-700 ltr-nums">
                      {r.mobile}
                    </a>
                  )}
                  <p className="mt-1 text-xs text-muted">{fmt.dateTime(r.createdAt)}</p>
                  {r.lastLoginAt && <p className="text-xs text-muted">{t('residentsAdmin.lastLogin', { time: fmt.dateTime(r.lastLoginAt) })}</p>}
                </div>
                <Badge tone={TONE[r.status]}>{t(`residentsAdmin.statuses.${r.status}`)}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                {r.status === 'pending' && (
                  <>
                    <Button size="sm" variant="danger" icon={<X className="size-4" aria-hidden />} onClick={() => decide.mutate({ id: r.id, action: 'reject' })}>
                      {t('residentsAdmin.reject')}
                    </Button>
                    <Button size="sm" variant="success" icon={<Check className="size-4" aria-hidden />} loading={decide.isPending && decide.variables?.id === r.id} onClick={() => decide.mutate({ id: r.id, action: 'approve' })}>
                      {t('residentsAdmin.approve')}
                    </Button>
                  </>
                )}
                {r.status === 'active' && (
                  <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: r.id, action: 'disable' })}>
                    {t('residentsAdmin.disable')}
                  </Button>
                )}
                {(r.status === 'disabled' || r.status === 'rejected') && (
                  <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: r.id, action: 'enable' })}>
                    {t('residentsAdmin.enable')}
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setResetFor(r)}>
                  {t('residentsAdmin.resetPassword')}
                </Button>
                <Button size="sm" variant="ghost" className="text-red-700" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setRemoveFor(r)}>
                  {t('residentsAdmin.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!resetFor}
        onClose={() => setResetFor(null)}
        title={resetFor ? `${t('residentsAdmin.resetPassword')} — ${t('resident.villaHeader', { villa: resetFor.villaNumber })}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={reset.isPending}
              onClick={() => {
                const parsed = residentPasswordResetSchema.safeParse({ password });
                if (!parsed.success) return setPasswordError(fieldErrorsFromIssues(parsed.error.issues).password ?? 'validation.invalid');
                setPasswordError(null);
                reset.mutate();
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Field label={t('residentsAdmin.newPassword')} required error={passwordError} hint={t('validation.passwordComplexity')}>
          {(a) => <Input {...a} dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
      </Dialog>
      <Dialog
        open={!!removeFor}
        onClose={() => setRemoveFor(null)}
        title={t('residentsAdmin.remove')}
        description={removeFor ? t('residentsAdmin.removeConfirm', { villa: removeFor.villaNumber }) : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoveFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              {t('residentsAdmin.remove')}
            </Button>
          </>
        }
      >
        {remove.isError && <Banner tone="danger">{t('errors.internal_error')}</Banner>}
      </Dialog>
    </div>
  );
}
