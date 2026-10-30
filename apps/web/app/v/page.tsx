'use client';

import { CheckCircle2, DoorOpen, ShieldQuestion, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OwnerConfirmationDTO } from '@vms/shared';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner, ErrorState } from '@/components/ui/feedback';
import { Button, Card, Spinner } from '@/components/ui/primitives';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** Villa owner's confirmation page, opened from the link the guard sends. The token stays in the URL fragment. */
function OwnerConfirmation() {
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [changing, setChanging] = useState(false);
  useEffect(() => setToken(window.location.hash.slice(1) || null), []);

  const q = useQuery({
    queryKey: ['owner', token],
    queryFn: () => api<OwnerConfirmationDTO>('/public/owner/view', { body: { token } }),
    enabled: !!token,
    retry: (n, err) => !(isApiError(err) && err.status === 404) && n < 2,
  });
  const respond = useMutation({
    mutationFn: (response: 'confirmed' | 'declined') => api<OwnerConfirmationDTO>('/public/owner/respond', { body: { token, response } }),
    onSuccess: (data) => {
      qc.setQueryData(['owner', token], data);
      setChanging(false);
    },
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
        <Banner tone="warning">{t('owner.invalid')}</Banner>
      </Card>
    );
  }
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const answered = d.response && !changing;

  return (
    <Card className="space-y-5 p-6 text-center animate-slide-up">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-teal-50 text-teal-700">
        <ShieldQuestion className="size-8" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-semibold text-muted">{d.compoundName}</p>
        <h1 className="mt-1 text-xl font-extrabold text-navy-900">{t('owner.title')}</h1>
        <p className="mt-2 text-navy-800">{t('owner.body', { villa: d.villaNumber, time: fmt.dateTime(d.enteredAt) })}</p>
        {d.fullName && <p className="mt-1 text-lg font-bold text-navy-900">{t('owner.visitor', { name: d.fullName })}</p>}
      </div>
      {d.status === 'exited' && (
        <Banner tone="info" icon={<DoorOpen className="size-5" aria-hidden />}>
          {t('owner.exited')}
        </Banner>
      )}
      {answered ? (
        <div className="space-y-3">
          <Banner tone={d.response === 'confirmed' ? 'success' : 'warning'} icon={d.response === 'confirmed' ? <CheckCircle2 className="size-5" aria-hidden /> : <XCircle className="size-5" aria-hidden />}>
            {d.response === 'confirmed' ? t('owner.confirmed') : t('owner.declined')}
          </Banner>
          <Button variant="ghost" onClick={() => setChanging(true)}>
            {t('owner.change')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-semibold text-navy-900">{t('owner.question')}</p>
          <Button size="lg" variant="success" block loading={respond.isPending && respond.variables === 'confirmed'} onClick={() => respond.mutate('confirmed')} icon={<CheckCircle2 className="size-5" aria-hidden />}>
            {t('owner.confirm')}
          </Button>
          <Button size="lg" variant="danger" block loading={respond.isPending && respond.variables === 'declined'} onClick={() => respond.mutate('declined')} icon={<XCircle className="size-5" aria-hidden />}>
            {t('owner.decline')}
          </Button>
        </div>
      )}
      {respond.isError && <Banner tone="danger">{isApiError(respond.error) ? t.dynamic(respond.error.messageKey) : t('errors.internal_error')}</Banner>}
    </Card>
  );
}

export default function OwnerPage() {
  return (
    <PublicShell>
      <OwnerConfirmation />
    </PublicShell>
  );
}
