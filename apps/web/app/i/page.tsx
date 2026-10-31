'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InvitePassDTO } from '@vms/shared';
import { QrCode } from '@/components/qr-code';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner, ErrorState } from '@/components/ui/feedback';
import { Card, Spinner } from '@/components/ui/primitives';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** The invited visitor's page: the QR to show at the gate. The token stays in the URL fragment. */
function InvitePass() {
  const { t } = useI18n();
  const fmt = useFormat();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => setToken(window.location.hash.slice(1) || null), []);
  const q = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InvitePassDTO>('/public/invites/view', { body: { token } }),
    enabled: !!token,
    refetchInterval: 30_000,
    retry: (n, err) => !(isApiError(err) && err.status === 404) && n < 2,
  });
  if (token === undefined || (token && q.isLoading)) {
    return (
      <Card className="grid min-h-48 place-items-center p-8">
        <Spinner label={t('common.loading')} />
      </Card>
    );
  }
  if (!token || (q.isError && isApiError(q.error) && q.error.status === 404)) {
    return (
      <Card className="p-6">
        <Banner tone="warning">{t('invitePass.invalid')}</Banner>
      </Card>
    );
  }
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="mx-auto max-w-sm overflow-hidden rounded-3xl border border-line bg-white shadow-raised animate-pop">
      <div className="bg-navy-900 px-6 pb-5 pt-6 text-center text-white">
        <p className="text-sm font-semibold text-teal-200">{d.compoundName}</p>
        <p className="mt-1 text-lg font-extrabold">{t('invitePass.title')}</p>
        {d.fullName && <p className="mt-1 font-bold">{d.fullName}</p>}
      </div>
      <div className="space-y-4 p-6 text-center">
        {d.status === 'expected' ? (
          <>
            <div className="flex justify-center">
              <div className="rounded-2xl border border-line p-3">
                <QrCode value={d.qrValue} size={240} label={t('invitePass.show')} />
              </div>
            </div>
            <p className="font-bold text-navy-900">{t('invitePass.show')}</p>
          </>
        ) : d.status === 'inside' ? (
          <Banner tone="success" icon={<CheckCircle2 className="size-5" aria-hidden />}>
            {t('invitePass.inside')}
          </Banner>
        ) : (
          <Banner tone="warning" icon={<XCircle className="size-5" aria-hidden />}>
            {d.status === 'cancelled' ? t('invitePass.cancelled') : t('invitePass.used')}
          </Banner>
        )}
        <div className="rounded-2xl bg-navy-50 p-3 text-start text-sm">
          <p className="font-bold text-navy-900 ltr-nums">{t('invitePass.villa', { villa: d.villaNumber })}</p>
          {d.expectedAt && <p className="text-navy-800">{t('invitePass.expected', { time: fmt.dateTime(d.expectedAt) })}</p>}
        </div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <PublicShell>
      <InvitePass />
    </PublicShell>
  );
}
