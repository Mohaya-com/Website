import { router, useLocalSearchParams } from 'expo-router';
import { FlaskConical, HelpCircle, MessageSquareLock, Pencil, Send, ShieldCheck, Smartphone } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, View, type TextInputInstance } from 'react-native';
import { OTP, fieldErrorsFromIssues, normalizeDigits, otpRequestSchema, type AuthResultDTO, type DocumentType, type OtpChallengeDTO } from '@vms/shared';
import { DocumentNumberInput, PhoneInput, type PhoneValue } from '@/components/inputs';
import { AppText, Banner, Button, Card, Field, Input, Row, Screen, Segmented } from '@/components/ui';
import { API_URL, api, isApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, flipX, space } from '@/lib/theme';

function useCountdown(seconds: number, key: unknown) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds, key]);
  return left;
}

/**
 * Visitor sign-in / registration. The server responds identically whether or not the identity is registered;
 * stored information is shown only after the OTP sent to the registered mobile is verified.
 */
export default function VisitorVerify() {
  const { t, locale } = useI18n();
  const { signIn } = useSession();
  const params = useLocalSearchParams<{ next?: string }>();
  const { data: config } = usePublicConfig();
  const [documentType, setDocumentType] = useState<DocumentType>('national_id');
  const [documentNumber, setDocumentNumber] = useState('');
  const [phone, setPhone] = useState<PhoneValue>({ country: 'SA', number: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallengeDTO | null>(null);
  const [code, setCode] = useState('');
  const codeRef = useRef<TextInputInstance>(null);
  const resendLeft = useCountdown(challenge?.resendAfterSeconds ?? 0, challenge?.challengeId);
  const smsUnavailable = config ? !config.sms.available : false;

  async function requestCode() {
    setError(null);
    const parsed = otpRequestSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse({ documentType, documentNumber, mobile: phone.number, mobileCountry: phone.country, locale });
    if (!parsed.success) {
      setFields(fieldErrorsFromIssues(parsed.error.issues));
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const res = await api<OtpChallengeDTO>('/auth/visitor/request-otp', { body: { documentType, documentNumber, mobile: phone.number, mobileCountry: phone.country, locale } });
      setChallenge(res);
      setCode('');
      setTimeout(() => codeRef.current?.focus(), 200);
    } catch (err) {
      if (isApiError(err)) {
        setFields(err.fields);
        setError(err.messageKey);
      } else setError('errors.internal_error');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!challenge) return;
    const clean = normalizeDigits(code).replace(/\D/g, '');
    if (clean.length !== OTP.length) {
      setFields({ code: 'validation.otpLength' });
      return;
    }
    setFields({});
    setError(null);
    setBusy(true);
    try {
      const res = await api<AuthResultDTO>('/auth/visitor/verify-otp', { body: { challengeId: challenge.challengeId, code: clean, client: 'mobile' } });
      await signIn(res);
      if (res.session.kind === 'registrant') router.replace({ pathname: '/visitor-register', params: params.next ? { next: params.next } : {} });
      else router.replace((params.next as never) ?? '/(visitor)/home');
    } catch (err) {
      setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']}>
      <Row gap={space.md}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: colors.teal600, alignItems: 'center', justifyContent: 'center' }}>
          {challenge ? <MessageSquareLock size={24} color={colors.white} /> : <ShieldCheck size={24} color={colors.white} />}
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{challenge ? t('auth.otpTitle') : t('auth.visitorVerifyTitle')}</AppText>
          <AppText variant="caption">{challenge ? t('auth.otpSubtitle') : t('auth.visitorVerifySubtitle')}</AppText>
        </View>
      </Row>
      {error ? <Banner tone="danger">{t.dynamic(error)}</Banner> : null}
      {smsUnavailable && config?.allowArrivalRegistration ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="subheading">{t('arrival.title')}</AppText>
          <AppText variant="caption">{t('arrival.subtitle')}</AppText>
          <Button title={t('arrival.startCta')} variant="accent" size="lg" onPress={() => void Linking.openURL(`${API_URL}/arrive`)} />
          <Button title={t('gateLanding.viewMyPass')} variant="secondary" onPress={() => void Linking.openURL(`${API_URL}/arrive/status`)} />
        </Card>
      ) : smsUnavailable ? (
        <Banner tone="warning">{t('auth.smsUnavailable')}</Banner>
      ) : null}

      {!challenge ? (
        <Card style={{ gap: space.lg }}>
          <Field label={t('fields.documentType')} required>
            <Segmented
              label={t('fields.documentType')}
              value={documentType}
              onChange={setDocumentType}
              options={[
                { value: 'national_id', label: t('documentTypes.national_id') },
                { value: 'iqama', label: t('documentTypes.iqama') },
              ]}
            />
          </Field>
          <DocumentNumberInput value={documentNumber} onChange={setDocumentNumber} error={fields.documentNumber} />
          <PhoneInput value={phone} onChange={setPhone} error={fields.mobile} />
          <AppText variant="small">{t('auth.privacyConsent')}</AppText>
          <Button title={busy ? t('auth.sendingCode') : t('auth.sendCode')} variant="accent" size="lg" loading={busy} disabled={smsUnavailable} onPress={() => void requestCode()} icon={<Send size={20} color={colors.white} style={flipX()} />} />
        </Card>
      ) : (
        <Card style={{ gap: space.lg }}>
          {challenge.developmentDelivery ? (
            <Banner tone="dev" icon={<FlaskConical size={18} color={colors.violet900} />} action={<AppText weight="bold" style={{ color: colors.violet900, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(`${API_URL}/dev/otp`)}>{t('auth.devOtpLink')}</AppText>}>
              {t('auth.devOtpNotice')}
            </Banner>
          ) : null}
          <Field label={t('auth.otpCode')} required error={fields.code} hint={t('auth.codeExpiresIn', { minutes: Math.round(challenge.expiresInSeconds / 60) })}>
            <Input
              ref={codeRef}
              value={code}
              onChangeText={(v) => setCode(normalizeDigits(v).replace(/\D/g, '').slice(0, OTP.length))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={OTP.length}
              placeholder="••••••"
              accessibilityLabel={t('auth.otpCode')}
              onSubmitEditing={() => void verify()}
              style={{ fontSize: 30, letterSpacing: 12, textAlign: 'center', minHeight: 64 }}
            />
          </Field>
          <Button title={busy ? t('auth.verifying') : t('auth.verify')} variant="accent" size="lg" loading={busy} onPress={() => void verify()} />
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Button title={t('auth.changeDetails')} variant="ghost" size="sm" icon={<Pencil size={16} color={colors.navy800} />} onPress={() => setChallenge(null)} />
            <Button
              title={resendLeft > 0 ? t('auth.resendIn', { seconds: resendLeft }) : t('auth.resend')}
              variant="ghost"
              size="sm"
              disabled={resendLeft > 0 || busy}
              icon={<Smartphone size={16} color={colors.navy800} />}
              onPress={() => void requestCode()}
            />
          </Row>
          <View style={{ backgroundColor: colors.navy50, borderRadius: 12, padding: space.md, gap: 4 }}>
            <Row gap={6}>
              <HelpCircle size={16} color={colors.navy900} />
              <AppText weight="bold" style={{ color: colors.navy900 }}>
                {t('auth.noCodeHelpTitle')}
              </AppText>
            </Row>
            <AppText variant="caption" style={{ color: colors.navy800 }}>
              {t('auth.noCodeHelp')}
            </AppText>
          </View>
        </Card>
      )}
    </Screen>
  );
}
