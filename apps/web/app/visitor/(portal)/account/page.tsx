'use client';

import { Languages, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { VisitorSelfDTO } from '@vms/shared';
import { DocumentExpiryInput, expiryFromStored, expiryToInput, type ExpiryValue } from '@/components/inputs';
import { DocumentStatusBadge } from '@/components/status';
import { Banner } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { Button, Card, CardHeader, DetailItem, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useVisitLabels } from '@/components/visit-views';
import { api, isApiError } from '@/lib/api';
import { useFormat, useLogout, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

export default function VisitorAccountPage() {
  const { t, locale, setLocale } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const qc = useQueryClient();
  const toast = useToast();
  const logout = useLogout();
  const { data: session } = useSession();
  const visitor = session?.visitor;
  const [expiry, setExpiry] = useState<ExpiryValue | null>(null);
  useEffect(() => {
    if (visitor && !expiry) setExpiry(expiryFromStored(visitor.documentExpiryDate, visitor.documentExpiryCalendar, visitor.documentExpiryOriginal));
  }, [visitor, expiry]);
  const save = useMutation({
    mutationFn: () => api<VisitorSelfDTO>('/me/profile', { method: 'PATCH', body: { expectedVersion: visitor!.version, documentExpiry: expiryToInput(expiry!) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['session'] });
      toast(t('visitor.expiryUpdated'));
    },
  });
  const fieldError = save.error && isApiError(save.error) ? (save.error.fields['documentExpiry.date'] ?? save.error.fields.documentExpiry ?? null) : null;

  if (!visitor) return null;
  return (
    <div className="space-y-5">
      <PageHeader title={t('visitor.account')} />
      <Card>
        <CardHeader title={t('visitor.profileTitle')} icon={<ShieldCheck className="size-5" aria-hidden />} />
        <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <DetailItem className="sm:col-span-2" label={t('fields.fullName')} value={visitor.fullName} />
          <DetailItem label={t(`documentTypes.${visitor.documentType}`)} value={visitor.documentNumberMasked} mono />
          <DetailItem label={t('fields.nationality')} value={labels.nationality(visitor.nationality)} />
          <DetailItem label={t('fields.mobile')} value={visitor.mobileMasked} mono />
          <DetailItem
            label={t('fields.documentExpiry')}
            value={
              <span className="flex flex-wrap items-center gap-2">
                {fmt.ymd(visitor.documentExpiryDate)} <DocumentStatusBadge expired={visitor.documentExpired} />
              </span>
            }
          />
        </dl>
        <div className="px-5 pb-5">
          <Banner tone="info" icon={<Smartphone className="size-5" aria-hidden />}>
            {t('visitor.mobileChangeHint')}
          </Banner>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('visitor.updateExpiry')} subtitle={t('visitor.updateExpiryHint')} />
        <div className="space-y-4 p-5">
          {expiry && <DocumentExpiryInput value={expiry} onChange={setExpiry} error={fieldError} />}
          {save.isError && !fieldError && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('account.language')} subtitle={t('account.languageHint')} icon={<Languages className="size-5" aria-hidden />} />
        <div className="p-5">
          <Segmented
            label={t('account.language')}
            size="lg"
            value={locale}
            onChange={setLocale}
            options={[
              { value: 'ar', label: 'العربية' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/privacy" className="text-sm font-semibold text-navy-700 underline underline-offset-4">
          {t('auth.privacyLink')}
        </Link>
        <Button variant="secondary" size="lg" icon={<LogOut className="size-5 rtl:-scale-x-100" aria-hidden />} onClick={() => void logout()}>
          {t('common.logout')}
        </Button>
      </div>
    </div>
  );
}
