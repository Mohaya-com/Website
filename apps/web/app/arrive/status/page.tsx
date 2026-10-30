'use client';

import { CheckCircle2, Clock3, DoorOpen, Plus, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ArrivalStatusDTO } from '@vms/shared';
import { PassCard } from '@/components/pass-card';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner, ErrorState } from '@/components/ui/feedback';
import { ButtonLink, Card, Spinner } from '@/components/ui/primitives';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clearArrivalToken, loadArrivalToken, saveArrivalToken } from '../storage';

/** The token lives in the URL fragment (never sent to the server in the URL) or in this device's storage. */
function useStatusToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (fromHash) saveArrivalToken(fromHash);
    setToken(fromHash || loadArrivalToken());
  }, []);
  return token;
}

function ArrivalStatusView() {
  const { t } = useI18n();
  const token = useStatusToken();
  const q = useQuery({
    queryKey: ['arrival-status', token],
    queryFn: () => api<ArrivalStatusDTO>('/public/arrivals/status', { body: { token } }),
    enabled: !!token,
    retry: (count, err) => !(isApiError(err) && err.status === 404) && count < 3,
    // Poll while the decision is pending, then occasionally (check-in, expiry).
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 5_000 : 30_000),
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
      <Card className="space-y-4 p-6 text-center">
        <p className="text-muted">{t('arrival.lost')}</p>
        <ButtonLink href="/arrive" variant="accent" icon={<Plus className="size-5" aria-hidden />}>
          {t('arrival.newRequest')}
        </ButtonLink>
      </Card>
    );
  }
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;

  const newRequest = (
    <ButtonLink
      href="/arrive"
      variant="secondary"
      block
      icon={<Plus className="size-5" aria-hidden />}
      onClick={() => clearArrivalToken()}
    >
      {t('arrival.newRequest')}
    </ButtonLink>
  );

  if (s.status === 'pending') {
    return (
      <Card className="space-y-4 p-6 text-center" role="status" aria-live="polite">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-amber-50 text-amber-700">
          <Clock3 className="size-8 animate-pulse" aria-hidden />
        </span>
        <h1 className="text-xl font-extrabold text-navy-900">{t('arrival.pendingTitle')}</h1>
        <p className="text-muted">{t('arrival.pendingBody')}</p>
        <p className="text-sm">
          {t('arrival.reference')}: <span className="font-extrabold text-navy-900 ltr-nums">{s.reference}</span>
        </p>
        <p className="text-xs text-muted">{t('arrival.keepPage')}</p>
      </Card>
    );
  }

  if (s.status === 'rejected') {
    return (
      <Card className="space-y-4 p-6 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-red-50 text-red-700">
          <XCircle className="size-8" aria-hidden />
        </span>
        <h1 className="text-xl font-extrabold text-navy-900">{t('arrival.rejectedTitle')}</h1>
        {s.rejectReason && <Banner tone="danger">{s.rejectReason === 'expired' ? t('arrival.expiredReason') : s.rejectReason}</Banner>}
        <p className="text-muted">{t('arrival.rejectedBody')}</p>
        {newRequest}
      </Card>
    );
  }

  if (s.pass) {
    return (
      <div className="space-y-4">
        <Banner tone="success" icon={<CheckCircle2 className="size-5" aria-hidden />}>
          {t('arrival.approvedTitle')}
        </Banner>
        <PassCard pass={s.pass} />
      </div>
    );
  }
  return (
    <Card className="space-y-4 p-6 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-700">
        <DoorOpen className="size-8" aria-hidden />
      </span>
      <h1 className="text-xl font-extrabold text-navy-900">{s.visitStatus === 'checked_in' ? t('arrival.insideTitle') : t('arrival.visitClosed')}</h1>
      {s.visitStatus !== 'checked_in' && newRequest}
    </Card>
  );
}

export default function ArrivalStatusPage() {
  return (
    <PublicShell>
      <ArrivalStatusView />
    </PublicShell>
  );
}
