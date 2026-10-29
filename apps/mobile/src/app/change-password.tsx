import { router } from 'expo-router';
import { useState } from 'react';
import { changePasswordSchema, fieldErrorsFromIssues } from '@vms/shared';
import { Banner, Button, Card, Field, Input, Screen } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { homeFor, useSession } from '@/lib/session';

export default function ChangePassword() {
  const { t } = useI18n();
  const { session, refresh } = useSession();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = changePasswordSchema.safeParse({ currentPassword: form.currentPassword, newPassword: form.newPassword });
    const errs = parsed.success ? {} : fieldErrorsFromIssues(parsed.error.issues);
    if (form.newPassword !== form.confirm) errs.confirm = 'validation.passwordMismatch';
    setFields(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      await refresh();
      router.replace(homeFor({ ...session!, user: session!.user ? { ...session!.user, mustChangePassword: false } : undefined }) as never);
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
    <Screen edges={['bottom']}>
      {session?.user?.mustChangePassword ? <Banner tone="warning">{t('auth.changePasswordRequired')}</Banner> : null}
      <Card style={{ gap: 16 }}>
        {error ? <Banner tone="danger">{t.dynamic(error)}</Banner> : null}
        <Field label={t('fields.currentPassword')} required error={fields.currentPassword}>
          <Input secureTextEntry value={form.currentPassword} onChangeText={(v) => setForm({ ...form, currentPassword: v })} accessibilityLabel={t('fields.currentPassword')} ltrInput />
        </Field>
        <Field label={t('fields.newPassword')} required error={fields.newPassword} hint={t('validation.passwordLength')}>
          <Input secureTextEntry value={form.newPassword} onChangeText={(v) => setForm({ ...form, newPassword: v })} accessibilityLabel={t('fields.newPassword')} ltrInput textContentType="newPassword" />
        </Field>
        <Field label={t('fields.confirmPassword')} required error={fields.confirm}>
          <Input secureTextEntry value={form.confirm} onChangeText={(v) => setForm({ ...form, confirm: v })} accessibilityLabel={t('fields.confirmPassword')} ltrInput />
        </Field>
        <Button title={t('common.save')} size="lg" loading={busy} onPress={() => void submit()} />
      </Card>
    </Screen>
  );
}
