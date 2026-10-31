'use client';

import { BellRing, Home, LogOut, UserPlus, Wrench, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MessageKey, VisitorRecordDTO } from '@vms/shared';
import { api } from '@/lib/api';
import { useLogout, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { cn } from '../ui/primitives';
import { ConnectivityBanner, DemoBanner, LanguageSwitcher, Logo, SkipLink } from './chrome';

const TABS: { href: string; label: MessageKey; icon: LucideIcon; exact?: boolean; badge?: boolean }[] = [
  { href: '/resident', label: 'resident.nav.visitors', icon: Home, exact: true },
  { href: '/resident/invite', label: 'resident.nav.invite', icon: UserPlus },
  { href: '/resident/confirmations', label: 'resident.nav.confirmations', icon: BellRing, badge: true },
  { href: '/resident/maintenance', label: 'resident.nav.maintenance', icon: Wrench },
  { href: '/resident/villa', label: 'resident.nav.villa', icon: Home },
];

/** Residents' portal: bottom tabs on phones, top bar on larger screens. */
export function ResidentShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const logout = useLogout();
  const { data: session } = useSession();
  const pending = useQuery({ queryKey: ['resident', 'confirmations'], queryFn: () => api<{ items: VisitorRecordDTO[] }>('/resident/confirmations'), refetchInterval: 60_000 });
  const count = pending.data?.items.length ?? 0;
  const isActive = (tab: (typeof TABS)[number]) => (tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`));
  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <SkipLink />
      <ConnectivityBanner />
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-2 px-4">
          <Link href="/resident" aria-label={t('resident.portalTitle')}>
            <Logo />
          </Link>
          <nav aria-label={t('resident.portalTitle')} className="ms-4 hidden flex-1 items-center gap-1 md:flex">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive(tab) ? 'page' : undefined}
                className={cn('flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors', isActive(tab) ? 'bg-navy-50 text-navy-900' : 'text-muted hover:text-ink')}
              >
                {t(tab.label)}
                {tab.badge && count > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-navy-950 ltr-nums">{count}</span>}
              </Link>
            ))}
          </nav>
          <div className="flex-1 md:hidden" />
          {session?.resident && <span className="hidden rounded-full bg-navy-50 px-3 py-1 text-sm font-bold text-navy-800 sm:inline ltr-nums">{t('resident.villaHeader', { villa: session.resident.villaNumber })}</span>}
          <LanguageSwitcher />
          <button type="button" onClick={() => void logout()} className="grid size-10 place-items-center rounded-xl text-muted hover:bg-navy-50" aria-label={t('common.logout')}>
            <LogOut className="size-5 rtl:-scale-x-100" aria-hidden />
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 focus:outline-none">
        {children}
      </main>
      <nav aria-label={t('resident.portalTitle')} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab);
            return (
              <li key={tab.href}>
                <Link href={tab.href} aria-current={active ? 'page' : undefined} className={cn('relative flex h-16 flex-col items-center justify-center gap-1 px-1 text-center text-[10.5px] font-semibold leading-tight', active ? 'text-teal-700' : 'text-muted')}>
                  <span className={cn('relative grid h-7 w-11 place-items-center rounded-full transition-colors', active && 'bg-teal-50')}>
                    <Icon className="size-5" aria-hidden />
                    {tab.badge && count > 0 && <span className="absolute -top-1 end-0 grid min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-navy-950 ltr-nums">{count}</span>}
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
