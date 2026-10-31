'use client';

import {
  Building2,
  ClipboardCheck,
  History,
  Home,
  IdCard,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  UserRoundSearch,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hasPermission, type DashboardSummaryDTO, type MessageKey, type Permission, type SessionInfoDTO } from '@vms/shared';
import { api } from '@/lib/api';
import { useLogout, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { cn } from '../ui/primitives';
import { ConnectivityBanner, DemoBanner, LanguageSwitcher, LiveIndicator, Logo, NotificationBell, SkipLink } from './chrome';

interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  permission?: Permission;
  exact?: boolean;
  badge?: 'pending' | 'inside' | 'arrivals';
}

const OPERATIONS: NavItem[] = [
  { href: '/staff', label: 'nav.dashboard', icon: LayoutDashboard, exact: true },
  { href: '/staff/arrivals', label: 'nav.arrivals', icon: IdCard, permission: 'arrivals.review', badge: 'arrivals' },
  { href: '/staff/requests', label: 'nav.requests', icon: ClipboardCheck, permission: 'visits.approve', badge: 'pending' },
  { href: '/staff/visits', label: 'nav.visits', icon: History, permission: 'gate.quick_entry' },
  { href: '/staff/visitors', label: 'nav.visitors', icon: UserRoundSearch, permission: 'visitors.search' },
  { href: '/staff/log', label: 'nav.log', icon: ScrollText, permission: 'gate_log.read' },
];

const MANAGEMENT: NavItem[] = [
  { href: '/staff/gates', label: 'nav.gates', icon: ShieldCheck, permission: 'gates.manage' },
  { href: '/staff/residents', label: 'nav.residents', icon: Home, permission: 'residents.manage' },
  { href: '/staff/maintenance', label: 'nav.maintenance', icon: Wrench, permission: 'maintenance.manage' },
  { href: '/staff/villas', label: 'nav.villas', icon: Building2, permission: 'villas.manage' },
  { href: '/staff/users', label: 'nav.users', icon: Users, permission: 'users.manage' },
  { href: '/staff/settings', label: 'nav.settings', icon: Settings, permission: 'settings.manage' },
  { href: '/staff/audit', label: 'nav.audit', icon: KeyRound, permission: 'audit.read' },
];

function NavLinks({ items, role, onNavigate, summary, arrivalsPending }: { items: NavItem[]; role: SessionInfoDTO['role']; onNavigate?: () => void; summary?: DashboardSummaryDTO; arrivalsPending?: number }) {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {items
        .filter((i) => !i.permission || hasPermission(role, i.permission))
        .map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.href === '/staff' && role === 'security' ? Home : item.icon;
          const count = item.badge === 'pending' ? summary?.pending : item.badge === 'inside' ? summary?.inside : item.badge === 'arrivals' ? arrivalsPending : undefined;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition-colors',
                  active ? 'bg-white/12 text-white shadow-[inset_3px_0_0_#14ad9c] rtl:shadow-[inset_-3px_0_0_#14ad9c]' : 'text-navy-100 hover:bg-white/8 hover:text-white',
                )}
              >
                <Icon className={cn('size-5 shrink-0', active ? 'text-teal-200' : 'text-navy-200 group-hover:text-white')} aria-hidden />
                <span className="flex-1 truncate">{item.href === '/staff' && role === 'security' ? t('nav.home') : t(item.label)}</span>
                {count ? <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold ltr-nums', item.badge === 'pending' || item.badge === 'arrivals' ? 'bg-amber-400 text-navy-950' : 'bg-white/15 text-white')}>{count}</span> : null}
              </Link>
            </li>
          );
        })}
    </ul>
  );
}

function Sidebar({ session, onNavigate }: { session: SessionInfoDTO; onNavigate?: () => void }) {
  const { t } = useI18n();
  const logout = useLogout();
  const { data: summary } = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api<DashboardSummaryDTO>('/dashboard/summary'),
    refetchInterval: 30_000,
  });
  const reviewsArrivals = hasPermission(session.role, 'arrivals.review');
  const { data: arrivals } = useQuery({
    queryKey: ['arrivals', 'pending-count'],
    queryFn: () => api<{ pendingCount: number }>('/arrivals?status=pending&pageSize=1'),
    enabled: reviewsArrivals,
    refetchInterval: 30_000,
  });
  const showManagement = MANAGEMENT.some((i) => !i.permission || hasPermission(session.role, i.permission));
  return (
    <div className="flex h-full flex-col bg-navy-900 text-white">
      <div className="px-5 pb-4 pt-5">
        <Logo inverted />
      </div>
      <nav aria-label={t('app.name')} className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        <div>
          <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-navy-200/80">{t('admin.sections.operations')}</p>
          <NavLinks items={OPERATIONS} role={session.role} onNavigate={onNavigate} summary={summary} arrivalsPending={arrivals?.pendingCount} />
        </div>
        {showManagement && (
          <div>
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-navy-200/80">{t('admin.sections.management')}</p>
            <NavLinks items={MANAGEMENT} role={session.role} onNavigate={onNavigate} />
          </div>
        )}
      </nav>
      <div className="border-t border-white/10 p-3">
        <Link href="/staff/account" onClick={onNavigate} className="flex items-center gap-3 rounded-xl p-2 hover:bg-white/8">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-teal-600 text-sm font-bold">{session.user?.fullName.slice(0, 1)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{session.user?.fullName}</span>
            <span className="block truncate text-xs text-navy-200">{t(`roles.${session.role}`)}</span>
          </span>
        </Link>
        <button type="button" onClick={() => void logout()} className="mt-1 flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-navy-100 hover:bg-white/8 hover:text-white">
          <LogOut className="size-4.5 rtl:-scale-x-100" aria-hidden />
          {t('common.logout')}
        </button>
      </div>
    </div>
  );
}

export function StaffShell({ initialSession, children }: { initialSession: SessionInfoDTO; children: ReactNode }) {
  const { t } = useI18n();
  const { data } = useSession();
  const session = data ?? initialSession;
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <SkipLink />
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <Sidebar session={session} />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t('common.more')}>
          <button type="button" className="absolute inset-0 bg-navy-950/50 animate-fade-in" onClick={() => setDrawer(false)} aria-label={t('common.close')} />
          <div className="absolute inset-y-0 start-0 w-[min(300px,85vw)] animate-slide-up shadow-raised">
            <Sidebar session={session} onNavigate={() => setDrawer(false)} />
          </div>
          <button type="button" onClick={() => setDrawer(false)} className="absolute end-3 top-3 grid size-10 place-items-center rounded-xl bg-white text-navy-900" aria-label={t('common.close')}>
            <X className="size-5" aria-hidden />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <ConnectivityBanner />
        <DemoBanner />
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setDrawer(true)} className="grid size-10 place-items-center rounded-xl text-navy-800 hover:bg-navy-50 lg:hidden" aria-label={t('common.more')} aria-expanded={drawer}>
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="lg:hidden">
            <Logo compact />
          </span>
          <div className="flex-1" />
          <LiveIndicator />
          <LanguageSwitcher />
          <NotificationBell href="/staff/notifications" />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
