'use client';

import { ShieldPlus } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fieldErrorsFromIssues, firstAdminSetupSchema } from '@vms/shared';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner, ErrorState } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Button, Card, Spinner } from '@/components/ui/primitives';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** One-time first-administrator setup guarded by the SETUP_TOKEN environment variable. */
export default function SetupPage() {
  const { t } = useI18n();
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => api<{ available: boolean }>('/setup/status') });
  const [form, setForm] = useState({ setupToken: '', username: '', fullName: '', password: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = firstAdminSetupSchema.safeParse(form);
    if (!parsed.success) {
      setFields(fieldErrorsFromIssues(parsed.error.issues));
      return;
    }
    setFields({});
    setBusy(true);
    try {
      await api('/setup/first-admin', { body: parsed.data });
      setDone(true);
    } catch (err) {
      setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <Card className="p-6 sm:p-8 animate-slide-up">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-navy-900 text-white">
            <ShieldPlus className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-extrabold text-navy-900">{t('auth.setupTitle')}</h1>
            <p className="text-sm text-muted">{t('auth.setupSubtitle')}</p>
          </div>
        </div>
        {status.isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : status.isError ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        ) : done ? (
          <Banner tone="success" action={<Link className="font-bold underline" href="/login">{t('common.signIn')}</Link>}>
            {t('auth.setupDone')}
          </Banner>
        ) : !status.data?.available ? (
          <Banner tone="info">{t('errors.setup_unavailable')}</Banner>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            {error && <Banner tone="danger">{t.dynamic(error)}</Banner>}
            <Field label={t('auth.setupToken')} required error={fields.setupToken}>
              {(a) => <Input {...a} dir="ltr" type="password" autoComplete="off" value={form.setupToken} onChange={(e) => setForm({ ...form, setupToken: e.target.value })} />}
            </Field>
            <Field label={t('fields.fullName')} required error={fields.fullName}>
              {(a) => <Input {...a} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}
            </Field>
            <Field label={t('fields.username')} required error={fields.username} hint={t('validation.username')}>
              {(a) => <Input {...a} dir="ltr" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />}
            </Field>
            <Field label={t('fields.password')} required error={fields.password} hint={t('validation.passwordLength')}>
              {(a) => <Input {...a} dir="ltr" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
            </Field>
            <Button type="submit" size="lg" block loading={busy}>
              {t('common.create')}
            </Button>
          </form>
        )}
      </Card>
    </PublicShell>
  );
}
