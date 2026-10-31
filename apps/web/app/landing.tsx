'use client';

import { ArrowLeft, Home, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PublicShell } from '@/components/shell/public-shell';
import { useI18n } from '@/lib/i18n';

function EntryCard({ href, icon, title, hint, accent }: { href: string; icon: ReactNode; title: string; hint: string; accent?: boolean }) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-4 rounded-2xl border p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-raised ${accent ? 'border-teal-200 bg-white' : 'border-line bg-white'}`}
    >
      <span className={`grid size-14 shrink-0 place-items-center rounded-2xl ${accent ? 'bg-teal-600 text-white' : 'bg-navy-900 text-white'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-extrabold text-navy-900">{title}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
      <ArrowLeft className="size-5 shrink-0 text-muted transition-transform group-hover:-translate-x-1 ltr:rotate-180 ltr:group-hover:translate-x-1" aria-hidden />
    </Link>
  );
}

export function Landing() {
  const { t } = useI18n();
  return (
    <PublicShell>
      <div className="animate-slide-up">
        <h1 className="text-3xl font-extrabold leading-tight text-navy-900 sm:text-4xl">{t('auth.welcomeTitle')}</h1>
        <p className="mt-2 text-base text-muted">{t('app.tagline')}</p>
        <p className="mt-6 text-sm font-semibold text-navy-800">{t('auth.welcomeSubtitle')}</p>
        <div className="mt-3 space-y-3">
          <EntryCard href="/login?as=resident" accent icon={<Home className="size-7" aria-hidden />} title={t('auth.residentEntry')} hint={t('auth.residentEntryHint')} />
          <EntryCard href="/login" icon={<ShieldCheck className="size-7" aria-hidden />} title={t('auth.staffEntry')} hint={t('auth.staffEntryHint')} />
        </div>
        <p className="mt-5 text-center text-sm">
          <Link href="/resident/signup" className="font-semibold text-teal-700 underline-offset-4 hover:underline">
            {t('resident.signupLink')}
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
