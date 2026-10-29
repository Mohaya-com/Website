import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { BadgeCheck } from 'lucide-react-native';
import { useState } from 'react';
import { fieldErrorsFromIssues, visitorRegistrationSchema, type SessionInfoDTO } from '@vms/shared';
import { ExpiryInput, NationalityPicker, emptyExpiry, expiryToInput, type ExpiryValue } from '@/components/inputs';
import { AppText, Banner, Button, Card, Detail, DetailGrid, Field, Input, Row, Screen } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { homeFor, useSession } from '@/lib/session';
import { colors, ltr, space } from '@/lib/theme';

/** Completes a verified registrant's profile. Identity details stay in memory only (never stored on the device). */
export default function VisitorRegister() {
  const { t, locale } = useI18n();
  const { session, setSession } = useSession();
  const params = useLocalSearchParams<{ next?: string }>();
  const [fullName, setFullName] = useState('');
  const [nationality, setNationality] = useState('');
  const [expiry, setExpiry] = useState<ExpiryValue>(emptyExpiry());
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) return <Redirect href="/welcome" />;
  if (session.kind !== 'registrant') return <Redirect href={homeFor(session) as never} />;
  const r = session.registrant!;

  async function submit() {
    const body = { fullName, nationality, documentExpiry: expiryToInput(expiry), locale };
    const parsed = visitorRegistrationSchema.safeParse(body);
    if (!parsed.success) {
      setFields(fieldErrorsFromIssues(parsed.error.issues));
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const res = await api<{ session: SessionInfoDTO }>('/me/register', { body });
      setSession(res.session);
      router.replace((params.next as never) ?? '/(visitor)/home');
    } catch (err) {
      if (isApiError(err)) {
        setFields(err.fields);
        setError(err.messageKey);
      }
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <AppText variant="caption">{t('visitor.registerSubtitle')}</AppText>
      <Card style={{ backgroundColor: colors.teal50, borderColor: colors.teal100 }}>
        <DetailGrid>
          <Detail label={t(`documentTypes.${r.documentType}`)} value={ltr(r.documentNumberMasked)} />
          <Detail
            label={t('fields.mobile')}
            value={
              <Row gap={4}>
                <AppText weight="bold">{ltr(r.mobileMasked)}</AppText>
                <BadgeCheck size={16} color={colors.teal700} />
              </Row>
            }
          />
        </DetailGrid>
      </Card>
      {error ? <Banner tone="danger">{t.dynamic(error)}</Banner> : null}
      <Card style={{ gap: space.lg }}>
        <Field label={t('fields.fullName')} required error={fields.fullName} hint={t('fields.fullNameHint')}>
          <Input value={fullName} onChangeText={setFullName} autoComplete="name" textContentType="name" accessibilityLabel={t('fields.fullName')} invalid={Boolean(fields.fullName)} />
        </Field>
        <NationalityPicker value={nationality} onChange={setNationality} error={fields.nationality} />
        <ExpiryInput value={expiry} onChange={setExpiry} error={fields['documentExpiry.date'] ?? fields.documentExpiry} />
        <Button title={t('visitor.registerSubmit')} variant="accent" size="lg" loading={busy} onPress={() => void submit()} />
      </Card>
    </Screen>
  );
}
