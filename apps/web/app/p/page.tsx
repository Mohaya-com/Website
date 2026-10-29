'use client';

import { QrCode, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { extractPassToken } from '@vms/shared';
import { ScanConsole } from '@/components/scan-console';
import { PublicShell } from '@/components/shell/public-shell';
import { StaffShell } from '@/components/shell/staff-shell';
import { Banner } from '@/components/ui/feedback';
import { ButtonLink, Card, PageHeader, Spinner } from '@/components/ui/primitives';
import { useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/**
 * Web fallback for pass links opened by a phone's native camera. The token lives in the URL fragment,
 * so it is never sent to the server in the request line or logs. Only signed-in staff can verify it.
 */
export default function PassLinkPage() {
  const { t } = useI18n();
  const { data: session, isLoading } = useSession();
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const value = extractPassToken(window.location.href);
    setToken(value);
    // Remove the token from the address bar and history once read.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (isLoading || token === undefined) {
    return (
      <PublicShell>
        <Card className="grid min-h-48 place-items-center">
          <Spinner label={t('common.loading')} />
        </Card>
      </PublicShell>
    );
  }

  if (session?.kind === 'staff' && token) {
    return (
      <StaffShell initialSession={session}>
        <PageHeader title={t('scan.title')} />
        <ScanConsole initialQr={token} />
      </StaffShell>
    );
  }

  return (
    <PublicShell>
      <Card className="p-6 text-center animate-slide-up">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-navy-900 text-white">
          <QrCode className="size-7" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-extrabold text-navy-900">{t('passLanding.title')}</h1>
        {token ? <p className="mt-2 text-muted">{t('passLanding.staffOnly')}</p> : <Banner tone="warning" className="mt-4 text-start">{t('passLanding.invalid')}</Banner>}
        <ButtonLink href="/login" className="mt-6" size="lg" icon={<ShieldCheck className="size-5" aria-hidden />}>
          {t('passLanding.signInStaff')}
        </ButtonLink>
      </Card>
    </PublicShell>
  );
}
