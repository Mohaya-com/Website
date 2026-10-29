'use client';

import { FlaskConical, HelpCircle, MessageSquareLock, Pencil, Send, ShieldCheck, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OTP, fieldErrorsFromIssues, normalizeDigits, otpRequestSchema, type AuthResultDTO, type DocumentType, type OtpChallengeDTO } from '@vms/shared';
import { DocumentNumberInput, PhoneInput, type PhoneValue } from '@/components/inputs';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner } from '@/components/ui/feedback';
import { Field, Input, Segmented } from '@/components/ui/form';
import { Button, Card } from '@/components/ui/primitives';
import { api, isApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

function useCountdown(seconds: number, key: unknown) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds, key]);
  return left;
}

/** Visitor sign-in / registration: identity + mobile → OTP. Responses never reveal whether an identity is registered. */
export function VisitorVerify({ next }: { next: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: config } = usePublicConfig();
  const [documentType, setDocumentType] = useState<DocumentType>('national_id');
  const [documentNumber, setDocumentNumber] = useState('');
  const [phone, setPhone] = useState<PhoneValue>({ country: 'SA', number: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallengeDTO | null>(null);
  const [code, setCode] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);
  const resendLeft = useCountdown(challenge?.resendAfterSeconds ?? 0, challenge?.challengeId);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const parsed = otpRequestSchema({ checksum: config?.identityChecksumValidation ?? true }).safeParse({
      documentType,
      documentNumber,
      mobile: phone.number,
      mobileCountry: phone.country,
      locale,
    });
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
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      if (isApiError(err)) {
        setFields(err.fields);
        setError(err.code === 'rate_limited' ? 'errors.rate_limited' : err.messageKey);
      } else setError('errors.internal_error');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: FormEvent) {
    e?.preventDefault();
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
      const res = await api<AuthResultDTO>('/auth/visitor/verify-otp', { body: { challengeId: challenge.challengeId, code: clean, client: 'web' } });
      qc.setQueryData(['session'], res.session);
      router.replace(res.session.kind === 'registrant' ? `/visitor/register?next=${encodeURIComponent(next)}` : next);
    } catch (err) {
      setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
      setBusy(false);
    }
  }

  const smsUnavailable = config && !config.sms.available;

  return (
    <PublicShell>
      <Card className="p-6 sm:p-8 animate-slide-up">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-teal-600 text-white">{challenge ? <MessageSquareLock className="size-6" aria-hidden /> : <ShieldCheck className="size-6" aria-hidden />}</span>
          <div>
            <h1 className="text-xl font-extrabold text-navy-900">{challenge ? t('auth.otpTitle') : t('auth.visitorVerifyTitle')}</h1>
            <p className="text-sm text-muted">{challenge ? t('auth.otpSubtitle') : t('auth.visitorVerifySubtitle')}</p>
          </div>
        </div>

        {error && (
          <Banner tone="danger" className="mb-4">
            {t.dynamic(error)}
          </Banner>
        )}
        {smsUnavailable && (
          <Banner tone="warning" className="mb-4">
            {t('auth.smsUnavailable')}
          </Banner>
        )}

        {!challenge ? (
          <form onSubmit={requestCode} noValidate className="space-y-5">
            <Field label={t('fields.documentType')} required>
              {() => (
                <Segmented
                  label={t('fields.documentType')}
                  size="lg"
                  value={documentType}
                  onChange={setDocumentType}
                  options={[
                    { value: 'national_id', label: t('documentTypes.national_id') },
                    { value: 'iqama', label: t('documentTypes.iqama') },
                  ]}
                />
              )}
            </Field>
            <DocumentNumberInput value={documentNumber} onChange={setDocumentNumber} error={fields.documentNumber} autoFocus />
            <PhoneInput value={phone} onChange={setPhone} error={fields.mobile} />
            <p className="text-xs leading-relaxed text-muted">
              {t('auth.privacyConsent')}{' '}
              <Link href="/privacy" className="font-semibold text-navy-700 underline underline-offset-4">
                {t('auth.privacyLink')}
              </Link>
            </p>
            <Button type="submit" size="lg" variant="accent" block loading={busy} disabled={Boolean(smsUnavailable)} icon={<Send className="size-5 rtl:-scale-x-100" aria-hidden />}>
              {busy ? t('auth.sendingCode') : t('auth.sendCode')}
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} noValidate className="space-y-5">
            {challenge.developmentDelivery && (
              <Banner tone="dev" icon={<FlaskConical className="size-5" aria-hidden />} action={<Link href="/dev/otp" target="_blank" className="whitespace-nowrap font-bold underline">{t('auth.devOtpLink')}</Link>}>
                {t('auth.devOtpNotice')}
              </Banner>
            )}
            <Field label={t('auth.otpCode')} required error={fields.code} hint={t('auth.codeExpiresIn', { minutes: Math.round(challenge.expiresInSeconds / 60) })}>
              {(a) => (
                <Input
                  {...a}
                  ref={codeRef}
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={OTP.length}
                  placeholder="••••••"
                  className="h-16 text-center text-3xl font-extrabold tracking-[0.5em] ltr-nums"
                  value={code}
                  onChange={(e) => {
                    const v = normalizeDigits(e.target.value).replace(/\D/g, '').slice(0, OTP.length);
                    setCode(v);
                  }}
                />
              )}
            </Field>
            <Button type="submit" size="lg" variant="accent" block loading={busy}>
              {busy ? t('auth.verifying') : t('auth.verify')}
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setChallenge(null)}>
                {t('auth.changeDetails')}
              </Button>
              <Button variant="ghost" size="sm" disabled={resendLeft > 0 || busy} onClick={() => void requestCode()} icon={<Smartphone className="size-4" aria-hidden />}>
                {resendLeft > 0 ? t('auth.resendIn', { seconds: resendLeft }) : t('auth.resend')}
              </Button>
            </div>
            <div className="rounded-xl bg-navy-50 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-navy-900">
                <HelpCircle className="size-4" aria-hidden />
                {t('auth.noCodeHelpTitle')}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-navy-800">{t('auth.noCodeHelp')}</p>
            </div>
          </form>
        )}
      </Card>
    </PublicShell>
  );
}
