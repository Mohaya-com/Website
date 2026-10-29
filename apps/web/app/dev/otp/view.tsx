'use client';

import { FlaskConical } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { DevOtpMessageDTO } from '@vms/shared';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner, EmptyState, ErrorState } from '@/components/ui/feedback';
import { Card, Spinner } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

export function DevOtpView() {
  const { t } = useI18n();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['dev-otp'], queryFn: () => api<{ items: DevOtpMessageDTO[] }>('/dev/otp-outbox'), refetchInterval: 3000 });
  return (
    <PublicShell>
      <Card className="p-6">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-violet-900">
          <FlaskConical className="size-6" aria-hidden />
          {t('devOtp.title')}
        </h1>
        <Banner tone="dev" className="mt-4">
          {t('devOtp.notice')}
        </Banner>
        <div className="mt-4">
          {q.isLoading ? (
            <Spinner />
          ) : q.isError ? (
            <ErrorState error={q.error} />
          ) : !q.data?.items.length ? (
            <EmptyState title={t('devOtp.empty')} />
          ) : (
            <ul className="divide-y divide-line">
              {q.data.items.map((m, i) => (
                <li key={`${m.createdAt}-${i}`} className="flex items-center justify-between py-3">
                  <span className="text-sm text-muted ltr-nums">
                    {m.to} · {fmt.time(m.createdAt)}
                  </span>
                  <span className="rounded-lg bg-violet-50 px-3 py-1 text-xl font-extrabold tracking-[0.3em] text-violet-900 ltr-nums">{m.code}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </PublicShell>
  );
}
