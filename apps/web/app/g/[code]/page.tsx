'use client';

import { CalendarPlus, DoorOpen, IdCard, Info, LogOut, QrCode, ScanLine } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PublicGateDTO } from '@vms/shared';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner, ErrorState } from '@/components/ui/feedback';
import { ButtonLink, Card, Spinner } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { usePublicConfig, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/**
 * Printed gate QR landing. The code identifies only the gate and the action; it never authorizes entry.
 * Staff are sent to the scanner preset for this gate; visitors to the request flow or their pass.
 */
function GateLanding({ code }: { code: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const action = search.get('a') === 'exit' ? 'exit' : 'entry';
  const { data: session, isLoading: sessionLoading } = useSession();
  const { data: config } = usePublicConfig();
  const gate = useQuery({ queryKey: ['public-gate', code], queryFn: () => api<PublicGateDTO>(`/public/gates/${encodeURIComponent(code)}`), retry: false });

  useEffect(() => {
    if (session?.kind === 'staff' && gate.data) router.replace(`/staff/scan?action=${action}&gate=${encodeURIComponent(gate.data.code)}`);
  }, [session, gate.data, action, router]);

  if (gate.isLoading || sessionLoading) {
    return (
      <Card className="grid min-h-48 place-items-center p-8">
        <Spinner label={t('common.loading')} />
      </Card>
    );
  }
  if (gate.isError || !gate.data) {
    return (
      <Card>
        <ErrorState error={gate.error} />
        <p className="pb-6 text-center text-sm text-muted">{t('gateLanding.invalidGate')}</p>
      </Card>
    );
  }
  const name = locale === 'ar' ? gate.data.nameAr : gate.data.nameEn;
  const requestHref = `/visitor/request?gate=${encodeURIComponent(gate.data.code)}`;
  const isVisitor = session?.kind === 'visitor';

  return (
    <Card className="overflow-hidden animate-slide-up">
      <div className="bg-navy-900 p-6 text-white">
        <span className="grid size-12 place-items-center rounded-2xl bg-white/10">{action === 'entry' ? <DoorOpen className="size-6" aria-hidden /> : <LogOut className="size-6 rtl:-scale-x-100" aria-hidden />}</span>
        <h1 className="mt-4 text-2xl font-extrabold">{action === 'entry' ? t('gateLanding.entryTitle', { gate: name }) : t('gateLanding.exitTitle', { gate: name })}</h1>
        <p className="mt-1 text-navy-100">{action === 'entry' ? t('gateLanding.entrySubtitle') : t('gateLanding.exitSubtitle')}</p>
      </div>
      <div className="space-y-3 p-6">
        {session?.kind === 'staff' ? (
          <ButtonLink href={`/staff/scan?action=${action}&gate=${gate.data.code}`} size="lg" block icon={<ScanLine className="size-5" aria-hidden />}>
            {t('gateLanding.staffContinue')}
          </ButtonLink>
        ) : action === 'entry' ? (
          <>
            {!isVisitor && config?.allowArrivalRegistration && (
              <ButtonLink href={`/arrive?gate=${encodeURIComponent(gate.data.code)}`} size="lg" variant="accent" block icon={<IdCard className="size-5" aria-hidden />}>
                {t('arrival.startCta')}
              </ButtonLink>
            )}
            {(isVisitor || config?.sms.available || !config?.allowArrivalRegistration) && (
              <ButtonLink
                href={isVisitor ? requestHref : `/visitor?next=${encodeURIComponent(requestHref)}`}
                size="lg"
                variant={!isVisitor && config?.allowArrivalRegistration ? 'secondary' : 'accent'}
                block
                icon={<CalendarPlus className="size-5" aria-hidden />}
              >
                {t('gateLanding.visitorContinue')}
              </ButtonLink>
            )}
          </>
        ) : !isVisitor && config?.allowArrivalRegistration && !config.sms.available ? (
          <ButtonLink href="/arrive/status" size="lg" variant="accent" block icon={<QrCode className="size-5" aria-hidden />}>
            {t('gateLanding.viewMyPass')}
          </ButtonLink>
        ) : (
          <ButtonLink href={isVisitor ? '/visitor/home' : `/visitor?next=${encodeURIComponent('/visitor/home')}`} size="lg" variant="accent" block icon={<QrCode className="size-5" aria-hidden />}>
            {t('gateLanding.viewMyPass')}
          </ButtonLink>
        )}
        {!session && (
          <ButtonLink href="/login" size="lg" variant="secondary" block>
            {t('auth.staffEntry')}
          </ButtonLink>
        )}
        <Banner tone="info" icon={<Info className="size-5" aria-hidden />}>
          {t('gateLanding.notAuthorization')}
        </Banner>
      </div>
    </Card>
  );
}

export default function GateLandingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return (
    <PublicShell>
      <Suspense>
        <GateLanding code={code} />
      </Suspense>
    </PublicShell>
  );
}
