'use client';

import { ClipboardCopy, KeyRound, Pencil, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldErrorsFromIssues, staffUserCreateSchema, type StaffRole, type StaffUserDTO } from '@vms/shared';
import { Dialog } from '@/components/ui/dialog';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Input, Segmented, Switch } from '@/components/ui/form';
import { Badge, Button, Card, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

function TempPasswordDialog({ password, onClose }: { password: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <Dialog open onClose={onClose} title={t('admin.tempPasswordTitle')} description={t('admin.tempPasswordBody')} icon={<KeyRound className="size-6 text-teal-700" aria-hidden />} footer={<Button onClick={onClose}>{t('common.done')}</Button>}>
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-navy-200 bg-navy-50 p-4">
        <code className="flex-1 text-center text-xl font-extrabold tracking-wider text-navy-900" dir="ltr">
          {password}
        </code>
        <Button size="sm" variant="secondary" icon={<ClipboardCopy className="size-4" aria-hidden />} onClick={() => void navigator.clipboard?.writeText(password).then(() => toast(t('common.copied'), 'info'))}>
          {t('common.copy')}
        </Button>
      </div>
    </Dialog>
  );
}

function UserDialog({ user, onClose, onTempPassword }: { user: StaffUserDTO | null; onClose: () => void; onTempPassword: (p: string) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const [form, setForm] = useState({ username: user?.username ?? '', fullName: user?.fullName ?? '', role: (user?.role ?? 'security') as StaffRole, phone: user?.phone ?? '', isActive: user?.isActive ?? true, password: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const self = user?.id === session?.user?.id;
  const save = useMutation({
    mutationFn: async () => {
      if (user) return { user: await api<StaffUserDTO>(`/users/${user.id}`, { method: 'PATCH', body: { fullName: form.fullName, role: form.role, isActive: form.isActive, phone: form.phone || null } }), temporaryPassword: null };
      return api<{ user: StaffUserDTO; temporaryPassword: string | null }>('/users', { body: { username: form.username, fullName: form.fullName, role: form.role, phone: form.phone || null, ...(form.password ? { password: form.password } : {}) } });
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast(t('admin.saved'));
      onClose();
      if (res.temporaryPassword) onTempPassword(res.temporaryPassword);
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });
  const submit = () => {
    if (!user) {
      const parsed = staffUserCreateSchema.safeParse({ username: form.username, fullName: form.fullName, role: form.role, phone: form.phone || null, password: form.password || undefined });
      if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
    }
    setFields({});
    save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={user ? t('admin.editUser') : t('admin.addUser')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
        <Field label={t('fields.username')} required error={fields.username} hint={!user ? t('validation.username') : undefined}>
          {(a) => <Input {...a} dir="ltr" autoCapitalize="none" disabled={Boolean(user)} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />}
        </Field>
        <Field label={t('fields.fullName')} required error={fields.fullName}>
          {(a) => <Input {...a} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}
        </Field>
        <Field label={t('fields.role')} required>
          {() => (
            <Segmented
              label={t('fields.role')}
              value={form.role}
              onChange={(role) => !self && setForm({ ...form, role })}
              options={[
                { value: 'security', label: t('roles.security') },
                { value: 'admin', label: t('roles.admin') },
              ]}
            />
          )}
        </Field>
        <Field label={t('fields.phone')} optional error={fields.phone}>
          {(a) => <Input {...a} dir="ltr" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
        </Field>
        {!user && (
          <Field label={t('fields.password')} optional error={fields.password} hint={t('admin.passwordOptionalHint')}>
            {(a) => <Input {...a} dir="ltr" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
          </Field>
        )}
        {user && !self && <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label={t('common.active')} description={user.role === 'admin' ? t('admin.lastAdminHint') : undefined} />}
      </div>
    </Dialog>
  );
}

export default function UsersPage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const list = useQuery({ queryKey: ['users'], queryFn: () => api<{ items: StaffUserDTO[] }>('/users') });
  const [dialog, setDialog] = useState<{ user: StaffUserDTO | null } | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffUserDTO | null>(null);
  const reset = useMutation({
    mutationFn: (id: string) => api<{ temporaryPassword: string }>(`/users/${id}/reset-password`, { method: 'POST' }),
    onSuccess: (res) => {
      setResetTarget(null);
      setTempPassword(res.temporaryPassword);
    },
    onError: (err) => toast(isApiError(err) ? t.dynamic(err.messageKey) : t('errors.internal_error'), 'error'),
  });
  return (
    <div>
      <PageHeader
        title={t('admin.usersTitle')}
        actions={
          <Button variant="accent" icon={<Plus className="size-5" aria-hidden />} onClick={() => setDialog({ user: null })}>
            {t('admin.addUser')}
          </Button>
        }
      />
      <Card>
        {list.isLoading ? (
          <LoadingRows />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data?.items.length ? (
          <EmptyState icon={<Users className="size-7" aria-hidden />} title={t('common.noResults')} />
        ) : (
          <DataTable
            caption={t('admin.usersTitle')}
            rows={list.data.items}
            rowKey={(u) => u.id}
            columns={[
              {
                key: 'name',
                header: t('fields.fullName'),
                cell: (u) => (
                  <div>
                    <p className="font-semibold">{u.fullName}</p>
                    <p className="text-xs text-muted" dir="ltr">
                      @{u.username}
                    </p>
                  </div>
                ),
              },
              { key: 'role', header: t('fields.role'), cell: (u) => <Badge tone={u.role === 'admin' ? 'navy' : 'teal'}>{t(`roles.${u.role}`)}</Badge> },
              {
                key: 'status',
                header: t('fields.status'),
                cell: (u) => (
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone={u.isActive ? 'green' : 'neutral'}>{u.isActive ? t('common.active') : t('common.inactive')}</Badge>
                    {u.mustChangePassword && <Badge tone="amber">{t('auth.changePasswordTitle')}</Badge>}
                  </span>
                ),
              },
              { key: 'last', header: t('fields.lastLogin'), cell: (u) => (u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : '—'), hideOnMobile: true },
              {
                key: 'actions',
                header: <span className="sr-only">{t('common.actions')}</span>,
                cell: (u) => (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setDialog({ user: u })}>
                      {t('common.edit')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setResetTarget(u)}>
                      {t('admin.resetPassword')}
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>
      {dialog && <UserDialog user={dialog.user} onClose={() => setDialog(null)} onTempPassword={setTempPassword} />}
      {tempPassword && <TempPasswordDialog password={tempPassword} onClose={() => setTempPassword(null)} />}
      <Dialog
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title={t('admin.resetPassword')}
        description={resetTarget?.fullName}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => resetTarget && reset.mutate(resetTarget.id)}>
              {t('admin.resetPassword')}
            </Button>
          </>
        }
      />
    </div>
  );
}
