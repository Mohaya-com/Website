import { router } from 'expo-router';
import { Eye, EyeOff, LogIn } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { AuthResultDTO } from '@vms/shared';
import { Banner, Button, Card, Field, Input, Screen } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { homeFor, useSession } from '@/lib/session';
import { colors, flipX } from '@/lib/theme';

export default function StaffLogin() {
  const { t } = useI18n();
  const { signIn } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    setError(null);
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = 'validation.required';
    if (!password) errs.password = 'validation.required';
    setFields(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await api<AuthResultDTO>('/auth/staff/login', { body: { username: username.trim(), password, client: 'mobile' } });
      await signIn(res);
      router.replace(homeFor(res.session) as never);
    } catch (err) {
      setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
      if (isApiError(err)) setFields(err.fields);
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Card style={{ gap: 16 }}>
        {error ? <Banner tone="danger">{t.dynamic(error)}</Banner> : null}
        <Field label={t('fields.username')} required error={fields.username}>
          <Input value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} textContentType="username" autoComplete="username" accessibilityLabel={t('fields.username')} ltrInput invalid={Boolean(fields.username)} />
        </Field>
        <Field label={t('fields.password')} required error={fields.password}>
          <View>
            <Input value={password} onChangeText={setPassword} secureTextEntry={!show} textContentType="password" autoComplete="current-password" accessibilityLabel={t('fields.password')} ltrInput invalid={Boolean(fields.password)} onSubmitEditing={() => void submit()} style={{ paddingEnd: 52 }} />
            <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow((s) => !s)} hitSlop={8} style={{ position: 'absolute', end: 4, top: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              {show ? <EyeOff size={20} color={colors.muted} /> : <Eye size={20} color={colors.muted} />}
            </Pressable>
          </View>
        </Field>
        <Button title={busy ? t('auth.signingIn') : t('common.signIn')} size="lg" loading={busy} onPress={() => void submit()} icon={<LogIn size={20} color={colors.white} style={flipX()} />} />
      </Card>
    </Screen>
  );
}
