'use client';

import { CalendarPlus, Home, ListChecks, UserRound, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { MessageKey } from '@vms/shared';
import { useI18n } from '@/lib/i18n';
import { cn } from '../ui/primitives';
import { ConnectivityBanner, DemoBanner, LanguageSwitcher, Logo, NotificationBell, SkipLink } from './chrome';

const TABS: { href: string; label: MessageKey; icon: LucideIcon }[] = [
  { href: '/visitor/home', label: 'nav.home', icon: Home },
  { href: '/visitor/request', label: 'nav.request', icon: CalendarPlus },
  { href: '/visitor/visits', label: 'nav.myVisits', icon: ListChecks },
  { href: '/visitor/account', label: 'nav.myAccount', icon: UserRound },
];

/** Visitor portal: focused single-column layout with bottom tabs on phones and a top bar on larger screens. */
export function VisitorShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <SkipLink />
      <ConnectivityBanner />
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-4">
          <Link href="/visitor/home" aria-label={t('nav.home')}>
            <Logo />
          </Link>
          <nav aria-label={t('app.name')} className="ms-6 hidden flex-1 items-center gap-1 sm:flex">
            {TABS.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined} className={cn('rounded-xl px-3 py-2 text-sm font-semibold transition-colors', active ? 'bg-navy-50 text-navy-900' : 'text-muted hover:text-ink')}>
                  {t(tab.label)}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1 sm:hidden" />
          <LanguageSwitcher />
          <NotificationBell href="/visitor/notifications" />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 focus:outline-none">
        {children}
      </main>
      <nav aria-label={t('app.name')} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] sm:hidden">
        <ul className="grid grid-cols-4">
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            const Icon = tab.icon;
            return (
              <li key={tab.href}>
                <Link href={tab.href} aria-current={active ? 'page' : undefined} className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', active ? 'text-teal-700' : 'text-muted')}>
                  <span className={cn('grid h-7 w-12 place-items-center rounded-full transition-colors', active && 'bg-teal-50')}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  {t(tab.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
