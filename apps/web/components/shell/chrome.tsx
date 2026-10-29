'use client';

import { Bell, CloudOff, FlaskConical, Languages, Radio, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useOnline, usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useLiveStatus } from '@/lib/realtime';
import { cn } from '../ui/primitives';

export function Logo({ compact = false, inverted = false }: { compact?: boolean; inverted?: boolean }) {
  const { t, locale } = useI18n();
  const { data } = usePublicConfig();
  const compound = data ? (locale === 'ar' ? data.compoundNameAr : data.compoundNameEn) : '';
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="size-10 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="16" fill={inverted ? '#ffffff' : '#0b1f3a'} />
        <path d="M18 46V26l14-10 14 10v20" fill="none" stroke={inverted ? '#0b1f3a' : '#fff'} strokeWidth="4" strokeLinejoin="round" />
        <path d="M27 46V35h10v11" fill="none" stroke="#14ad9c" strokeWidth="4" strokeLinejoin="round" />
      </svg>
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className={cn('block truncate text-[15px] font-extrabold', inverted ? 'text-white' : 'text-navy-900')}>{t('app.shortName')}</span>
          {compound && <span className={cn('block truncate text-xs', inverted ? 'text-navy-200' : 'text-muted')}>{compound}</span>}
        </span>
      )}
    </span>
  );
}

export function LanguageSwitcher({ className, inverted }: { className?: string; inverted?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const next = locale === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      lang={next}
      aria-label={`${t('common.language')}: ${next === 'ar' ? 'العربية' : 'English'}`}
      className={cn('inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors', inverted ? 'text-white hover:bg-white/10' : 'text-navy-800 hover:bg-navy-50', className)}
    >
      <Languages className="size-4.5" aria-hidden />
      {next === 'ar' ? 'العربية' : 'English'}
    </button>
  );
}

export function LiveIndicator() {
  const { t } = useI18n();
  const status = useLiveStatus();
  const meta =
    status === 'live'
      ? { label: t('connectivity.live'), icon: <Radio className="size-3.5" aria-hidden />, cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
      : status === 'offline'
        ? { label: t('connectivity.offline'), icon: <CloudOff className="size-3.5" aria-hidden />, cls: 'bg-red-50 text-red-800 ring-red-200' }
        : status === 'connecting'
          ? { label: t('connectivity.reconnecting'), icon: <RefreshCw className="size-3.5 animate-spin" aria-hidden />, cls: 'bg-amber-50 text-amber-800 ring-amber-200' }
          : { label: t('connectivity.polling'), icon: <RefreshCw className="size-3.5" aria-hidden />, cls: 'bg-slate-100 text-slate-700 ring-slate-200' };
  return (
    <span role="status" className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', meta.cls)}>
      {status === 'live' && <span className="size-1.5 animate-pulse rounded-full bg-emerald-600" aria-hidden />}
      {meta.icon}
      {meta.label}
    </span>
  );
}

export function ConnectivityBanner() {
  const { t } = useI18n();
  const online = useOnline();
  if (online) return null;
  return (
    <div role="alert" className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900">
      <CloudOff className="size-4" aria-hidden />
      {t('connectivity.offline')} — {t('connectivity.noOfflineAuthorization')}
    </div>
  );
}

export function DemoBanner() {
  const { t } = useI18n();
  const { data } = usePublicConfig();
  if (!data?.demoData) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-violet-100 px-4 py-1.5 text-center text-xs font-semibold text-violet-900">
      <FlaskConical className="size-3.5" aria-hidden />
      {t('app.demoData')}
    </div>
  );
}

export function NotificationBell({ href, inverted }: { href: string; inverted?: boolean }) {
  const { t } = useI18n();
  const { data } = useQuery({ queryKey: ['unread'], queryFn: () => api<{ count: number }>('/notifications/unread-count'), refetchInterval: 45_000 });
  const count = data?.count ?? 0;
  return (
    <Link
      href={href}
      aria-label={`${t('notifications.title')}${count ? ` (${count} ${t('notifications.unread')})` : ''}`}
      className={cn('relative inline-grid size-10 place-items-center rounded-xl transition-colors', inverted ? 'text-white hover:bg-white/10' : 'text-navy-800 hover:bg-navy-50')}
    >
      <Bell className="size-5" aria-hidden />
      {count > 0 && (
        <span className="absolute -top-0.5 -end-0.5 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-white ltr-nums">{count > 99 ? '99+' : count}</span>
      )}
    </Link>
  );
}

export function SkipLink() {
  const { t } = useI18n();
  return (
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-navy-900 focus:px-4 focus:py-2 focus:font-semibold focus:text-white">
      {t('common.skipToContent')}
    </a>
  );
}
