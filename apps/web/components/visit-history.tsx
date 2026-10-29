'use client';

import { AlertTriangle, DoorClosed, DoorOpen, History } from 'lucide-react';
import Link from 'next/link';
import type { VisitDTO, VisitorHistoryStatsDTO } from '@vms/shared';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { StatusBadge } from './status';
import { EmptyState } from './ui/feedback';
import { Badge } from './ui/primitives';
import { useVisitLabels } from './visit-views';

/** Chronological timeline of a visitor's visits with outcomes, actual times and overstay flags. */
export function VisitHistoryTimeline({ visits, stats, linkBase = '/staff/visits' }: { visits: VisitDTO[]; stats?: VisitorHistoryStatsDTO; linkBase?: string }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  if (!visits.length) return <EmptyState icon={<History className="size-7" aria-hidden />} title={t('admin.noPreviousVisits')} />;
  return (
    <div>
      {stats && (
        <p className="border-b border-line px-5 py-3 text-sm font-semibold text-muted ltr-nums">
          {t('admin.historyStats', { total: stats.total, completed: stats.completed, rejected: stats.rejected, overstays: stats.overstays })}
        </p>
      )}
      <ol className="relative space-y-0 px-5 py-4">
        {visits.map((v, i) => (
          <li key={v.id} className="relative flex gap-4 pb-5 last:pb-0">
            {i < visits.length - 1 && <span className="absolute start-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-line" aria-hidden />}
            <span className="relative mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-navy-50 text-xs font-bold text-navy-700 ring-4 ring-white ltr-nums">{i + 1}</span>
            <div className="min-w-0 flex-1 rounded-xl border border-line p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`${linkBase}/${v.id}`} className="font-bold text-navy-800 hover:underline ltr-nums">
                  {v.reference}
                </Link>
                <StatusBadge status={v.status} overdue={v.isOverdue} />
              </div>
              <p className="mt-1 text-sm text-ink">
                {fmt.dateTime(v.requestedEntryAt)} · {t('fields.villa')} <span className="font-semibold ltr-nums">{v.villa.number}</span> · {labels.reason(v)}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {v.checkedInAt && (
                  <span className="inline-flex items-center gap-1">
                    <DoorOpen className="size-3.5" aria-hidden />
                    {t('fields.actualEntry')}: {fmt.dateTime(v.checkedInAt)}
                  </span>
                )}
                {v.checkedOutAt && (
                  <span className="inline-flex items-center gap-1">
                    <DoorClosed className="size-3.5" aria-hidden />
                    {t('fields.actualExit')}: {fmt.dateTime(v.checkedOutAt)}
                  </span>
                )}
                {v.decidedBy && v.status !== 'rejected' && <span>{`${t('admin.timeline.approved')} · ${labels.actor(v.decidedBy)}`}</span>}
              </div>
              {v.rejectionReason && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800">{`${t('fields.rejectionReason')}: ${v.rejectionReason}`}</p>}
              {(v.overstayMinutes ?? 0) > 0 && (
                <Badge tone="red" className="mt-2" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
                  {t('admin.overstayFlag', { duration: fmt.duration(v.overstayMinutes!) })}
                </Badge>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
