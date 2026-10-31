'use client';

import { CheckCircle2, Home, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fieldErrorsFromIssues, normalizeDigits, residentSignupSchema } from '@vms/shared';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Button, ButtonLink, Card } from '@/components/ui/primitives';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** First registration of a villa account; an administrator activates it once. */
export default function ResidentSignupPage() {
  const { t } = useI18n();
  const [form, setForm] = useState({ villaNumber: '', password: '', passwordConfirm: '', fullName: '', mobile: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: unknown) => api('/auth/resident/signup', { body }),
    onError: (err) => isApiError(err) && setFields(err.fields),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <PublicShell>
      <Card className="p-6 sm:p-8 animate-slide-up">
        {save.isSuccess ? (
          <div className="space-y-4 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="size-8" aria-hidden />
            </span>
            <p className="text-navy-900">{t('resident.signupDone')}</p>
            <ButtonLink href="/login?as=resident" variant="accent" block>
              {t('resident.backToLogin')}
            </ButtonLink>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-navy-900 text-white">
                <Home className="size-6" aria-hidden />
              </span>
              <div>
                <h1 className="text-xl font-extrabold text-navy-900">{t('resident.signupTitle')}</h1>
                <p className="text-sm text-muted">{t('resident.signupSubtitle')}</p>
              </div>
            </div>
            <form
              noValidate
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const body = { ...form, villaNumber: normalizeDigits(form.villaNumber), mobile: form.mobile || null };
                const parsed = residentSignupSchema.safeParse(body);
                if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
                setFields({});
                save.mutate(body);
              }}
            >
              {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
              <Field label={t('resident.usernameLabel')} required error={fields.villaNumber}>
                {(a) => <Input {...a} dir="ltr" autoComplete="username" className="ltr-nums text-lg font-semibold" value={form.villaNumber} onChange={set('villaNumber')} autoFocus />}
              </Field>
              <Field label={t('fields.password')} required error={fields.password} hint={t('validation.passwordComplexity')}>
                {(a) => <Input {...a} type="password" dir="ltr" autoComplete="new-password" value={form.password} onChange={set('password')} />}
              </Field>
              <Field label={t('resident.passwordConfirm')} required error={fields.passwordConfirm}>
                {(a) => <Input {...a} type="password" dir="ltr" autoComplete="new-password" value={form.passwordConfirm} onChange={set('passwordConfirm')} />}
              </Field>
              <Field label={t('resident.fullName')} optional error={fields.fullName}>
                {(a) => <Input {...a} autoComplete="name" value={form.fullName} onChange={set('fullName')} />}
              </Field>
              <Field label={t('resident.mobile')} optional error={fields.mobile}>
                {(a) => <Input {...a} type="tel" inputMode="tel" dir="ltr" placeholder="05X XXX XXXX" className="ltr-nums" value={form.mobile} onChange={set('mobile')} />}
              </Field>
              <Button type="submit" size="lg" variant="accent" block loading={save.isPending} icon={<UserPlus className="size-5" aria-hidden />}>
                {t('resident.signupSubmit')}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm">
              <Link href="/login?as=resident" className="font-semibold text-teal-700 underline-offset-4 hover:underline">
                {t('resident.backToLogin')}
              </Link>
            </p>
          </>
        )}
      </Card>
    </PublicShell>
  );
}
