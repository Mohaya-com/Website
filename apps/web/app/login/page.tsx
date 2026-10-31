'use client';

import { Eye, EyeOff, Home, LogIn, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResultDTO } from '@vms/shared';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner } from '@/components/ui/feedback';
import { Field, Input, Segmented } from '@/components/ui/form';
import { normalizeDigits } from '@vms/shared';
import { Button, Card } from '@/components/ui/primitives';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'staff' | 'resident'>(search.get('as') === 'resident' ? 'resident' : 'staff');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    if (!username.trim() || !password) {
      setFields({ ...(username.trim() ? {} : { username: 'validation.required' }), ...(password ? {} : { password: 'validation.required' }) });
      return;
    }
    setBusy(true);
    try {
      if (mode === 'resident') {
        const res = await api<AuthResultDTO>('/auth/resident/login', { body: { username: normalizeDigits(username.trim()).toUpperCase(), password, client: 'web' } });
        qc.setQueryData(['session'], res.session);
        router.replace('/resident');
        return;
      }
      const res = await api<AuthResultDTO>('/auth/staff/login', { body: { username: username.trim(), password, client: 'web' } });
      qc.setQueryData(['session'], res.session);
      const next = search.get('next');
      router.replace(res.session.user?.mustChangePassword ? '/change-password' : next?.startsWith('/staff') ? next : '/staff');
    } catch (err) {
      if (isApiError(err)) {
        setError(err.messageKey);
        setFields(err.fields);
      } else setError('errors.internal_error');
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8 animate-slide-up">
      <div className="mb-5">
        <Segmented
          label={t('common.signIn')}
          size="lg"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
            setFields({});
          }}
          options={[
            { value: 'staff', label: t('resident.staffTab') },
            { value: 'resident', label: t('resident.loginTab') },
          ]}
        />
      </div>
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-navy-900 text-white">
          {mode === 'resident' ? <Home className="size-6" aria-hidden /> : <ShieldCheck className="size-6" aria-hidden />}
        </span>
        <div>
          <h1 className="text-xl font-extrabold text-navy-900">{mode === 'resident' ? t('resident.portalTitle') : t('auth.staffLoginTitle')}</h1>
          {mode === 'staff' && <p className="text-sm text-muted">{t('auth.staffLoginSubtitle')}</p>}
        </div>
      </div>
      {search.get('expired') && (
        <Banner tone="warning" className="mb-4">
          {t('auth.sessionExpired')}
        </Banner>
      )}
      {error && (
        <Banner tone="danger" className="mb-4">
          {t.dynamic(error)}
        </Banner>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label={mode === 'resident' ? t('resident.usernameLabel') : t('fields.username')} required error={fields.username}>
          {(a) => <Input {...a} dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />}
        </Field>
        <Field label={t('fields.password')} required error={fields.password}>
          {(a) => (
            <div className="relative">
              <Input {...a} dir="ltr" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pe-12" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 end-1 my-auto grid size-10 place-items-center rounded-lg text-muted hover:bg-slate-100" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
              </button>
            </div>
          )}
        </Field>
        <Button type="submit" size="lg" block loading={busy} icon={<LogIn className="size-5 rtl:-scale-x-100" aria-hidden />}>
          {busy ? t('auth.signingIn') : t('common.signIn')}
        </Button>
      </form>
      {mode === 'resident' && (
        <p className="mt-5 text-center text-sm">
          <Link href="/resident/signup" className="font-semibold text-teal-700 underline-offset-4 hover:underline">
            {t('resident.signupLink')}
          </Link>
        </p>
      )}
    </Card>
  );
}

export default function LoginPage() {
  return (
    <PublicShell>
      <Suspense>
        <LoginForm />
      </Suspense>
    </PublicShell>
  );
}
