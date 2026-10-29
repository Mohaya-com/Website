'use client';

import { useState, type FormEvent } from 'react';
import { changePasswordSchema, fieldErrorsFromIssues } from '@vms/shared';
import { Banner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Button } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = changePasswordSchema.safeParse({ currentPassword: form.currentPassword, newPassword: form.newPassword });
    const errs = parsed.success ? {} : fieldErrorsFromIssues(parsed.error.issues);
    if (form.newPassword !== form.confirm) errs.confirm = 'validation.passwordMismatch';
    setFields(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api('/auth/password', { body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      toast(t('auth.passwordChanged'));
      onDone();
    } catch (err) {
      if (isApiError(err)) {
        setFields(err.fields);
        if (!Object.keys(err.fields).length) setError(err.messageKey);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <Banner tone="danger">{t.dynamic(error)}</Banner>}
      <Field label={t('fields.currentPassword')} required error={fields.currentPassword}>
        {(a) => <Input {...a} dir="ltr" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />}
      </Field>
      <Field label={t('fields.newPassword')} required error={fields.newPassword} hint={t('validation.passwordLength')}>
        {(a) => <Input {...a} dir="ltr" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />}
      </Field>
      <Field label={t('fields.confirmPassword')} required error={fields.confirm}>
        {(a) => <Input {...a} dir="ltr" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />}
      </Field>
      <Button type="submit" size="lg" block loading={busy}>
        {t('common.save')}
      </Button>
    </form>
  );
}
