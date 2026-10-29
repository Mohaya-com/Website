'use client';

import { AlertTriangle, ArrowLeft, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { VisitDTO } from '@vms/shared';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { OverdueBadge, StatusBadge } from './status';
import { Card, Skeleton, cn } from './ui/primitives';
import { useVisitLabels } from './visit-views';

export function StatCard({ label, value, icon: Icon, tone, href, loading }: { label: string; value: number | undefined; icon: LucideIcon; tone: 'navy' | 'teal' | 'amber' | 'blue' | 'red' | 'slate' | 'green'; href?: string; loading?: boolean }) {
  const tones = {
    navy: 'bg-navy-50 text-navy-700',
    teal: 'bg-teal-50 text-teal-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700',
  } as const;
  const body = (
    <div className="flex items-center gap-4 p-5">
      <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', tones[tone])}>
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-muted">{label}</p>
        {loading ? <Skeleton className="mt-1 h-8 w-14" /> : <p className="text-3xl font-extrabold text-navy-900 ltr-nums">{value ?? 0}</p>}
      </div>
      {href && <ArrowLeft className="ms-auto size-5 text-muted ltr:rotate-180" aria-hidden />}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-card border border-line bg-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-raised">
      {body}
    </Link>
  ) : (
    <Card>{body}</Card>
  );
}

/** Row for operational lists (inside, expected, queue). */
export function VisitRow({ visit, href, meta, action }: { visit: VisitDTO; href: string; meta?: ReactNode; action?: ReactNode }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-navy-50/40">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold', visit.isOverdue ? 'bg-red-100 text-red-800' : 'bg-navy-100 text-navy-800')}>
          {visit.isOverdue ? <AlertTriangle className="size-5" aria-hidden /> : (visit.visitor?.fullName.slice(0, 1) ?? '?')}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-bold text-ink">{visit.visitor?.fullName}</span>
          <span className="block truncate text-sm text-muted">
            {t('fields.villa')} <span className="font-semibold ltr-nums">{visit.villa.number}</span> · {labels.reason(visit)} · <span className="ltr-nums">{visit.reference}</span>
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <div className="text-end text-sm">
          {meta ?? <span className="text-muted">{fmt.dateTime(visit.requestedEntryAt)}</span>}
        </div>
        {visit.isOverdue ? <OverdueBadge /> : <StatusBadge status={visit.status} />}
        {action}
      </div>
    </li>
  );
}
