'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '../ui/primitives';
import { ConnectivityBanner, DemoBanner, LanguageSwitcher, Logo, SkipLink } from './chrome';

/** Layout for sign-in, verification, gate and pass landing pages. */
export function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(1200px_600px_at_100%_-10%,var(--color-navy-100)_0%,transparent_60%),radial-gradient(900px_500px_at_-10%_110%,var(--color-teal-100)_0%,transparent_55%)]">
      <SkipLink />
      <ConnectivityBanner />
      <DemoBanner />
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" aria-label={t('common.goHome')}>
          <Logo />
        </Link>
        <LanguageSwitcher />
      </header>
      <main id="main" tabIndex={-1} className={cn('mx-auto w-full flex-1 px-4 pb-10 pt-4 focus:outline-none sm:pt-10', wide ? 'max-w-4xl' : 'max-w-lg')}>
        {children}
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-6 text-center text-xs text-muted">
        <Link href="/privacy" className="font-semibold underline-offset-4 hover:underline">
          {t('auth.privacyLink')}
        </Link>
      </footer>
    </div>
  );
}
