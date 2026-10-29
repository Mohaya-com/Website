'use client';

import { BadgeCheck, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fieldErrorsFromIssues, visitorRegistrationSchema, type SessionInfoDTO } from '@vms/shared';
import { DocumentExpiryInput, NationalitySelect, emptyExpiry, expiryToInput, type ExpiryValue } from '@/components/inputs';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Button, Card, DetailItem } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** Profile details are kept in memory only (not persisted in the browser). */
export function RegisterForm({ session, next }: { session: SessionInfoDTO; next: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [fullName, setFullName] = useState('');
  const [nationality, setNationality] = useState('');
  const [expiry, setExpiry] = useState<ExpiryValue>(emptyExpiry());
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = session.registrant!;

  async function submit(e: FormEvent) {
    e.preventDefault();
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
      qc.setQueryData(['session'], res.session);
      toast(t('visitor.registered'));
      router.replace(next);
    } catch (err) {
      if (isApiError(err)) {
        setFields(err.fields);
        setError(err.messageKey);
      }
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <Card className="p-6 sm:p-8 animate-slide-up">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-teal-600 text-white">
            <UserPlus className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-extrabold text-navy-900">{t('visitor.registerTitle')}</h1>
            <p className="text-sm text-muted">{t('visitor.registerSubtitle')}</p>
          </div>
        </div>
        <dl className="mb-5 grid grid-cols-2 gap-4 rounded-xl bg-teal-50 p-4">
          <DetailItem label={t(`documentTypes.${r.documentType}`)} value={r.documentNumberMasked} mono />
          <DetailItem label={t('fields.mobile')} value={<span className="inline-flex items-center gap-1">{r.mobileMasked} <BadgeCheck className="size-4 text-teal-700" aria-label="✓" /></span>} mono />
        </dl>
        {error && (
          <Banner tone="danger" className="mb-4">
            {t.dynamic(error)}
          </Banner>
        )}
        <form onSubmit={submit} noValidate className="space-y-5">
          <Field label={t('fields.fullName')} required error={fields.fullName} hint={t('fields.fullNameHint')}>
            {(a) => <Input {...a} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />}
          </Field>
          <NationalitySelect value={nationality} onChange={setNationality} error={fields.nationality} />
          <DocumentExpiryInput value={expiry} onChange={setExpiry} error={fields['documentExpiry.date'] ?? fields.documentExpiry} />
          <Button type="submit" size="lg" variant="accent" block loading={busy}>
            {t('visitor.registerSubmit')}
          </Button>
        </form>
      </Card>
    </PublicShell>
  );
}
