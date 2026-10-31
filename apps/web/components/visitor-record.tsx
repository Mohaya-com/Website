'use client';

import { CalendarClock, Clock, LogOut, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import type { VisitorRecordDTO } from '@vms/shared';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { Badge } from './ui/primitives';

/** One visitor of a villa (invitation or gate entry) for the residents' portal. */
export function VisitorRecordCard({ record, actions }: { record: VisitorRecordDTO; actions?: ReactNode }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const name = record.fullName ?? t('gate.unnamed');
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700">
          <UserRound className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[16px] font-bold text-navy-900">{name}</p>
            {record.invitedByResident ? <Badge tone="teal">{t('resident.invitedBadge')}</Badge> : <Badge tone="slate">{t('resident.gateBadge')}</Badge>}
            {record.status === 'cancelled' && <Badge tone="red">{t('resident.cancelled')}</Badge>}
            {record.ownerResponse === 'declined' && <Badge tone="red">{t('gate.ownerDeclined')}</Badge>}
          </div>
          <div className="mt-1 space-y-0.5 text-sm text-muted">
            {record.status === 'expected' && record.expectedAt && (
              <p className="flex items-center gap-1.5">
                <CalendarClock className="size-4" aria-hidden />
                {t('resident.expectedAt', { time: fmt.dateTime(record.expectedAt) })}
              </p>
            )}
            {record.enteredAt && (
              <p className="flex items-center gap-1.5">
                <Clock className="size-4" aria-hidden />
                {t('resident.enteredAt', { time: fmt.dateTime(record.enteredAt) })}
              </p>
            )}
            {record.exitedAt && (
              <p className="flex items-center gap-1.5">
                <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
                {t('resident.exitedAt', { time: fmt.dateTime(record.exitedAt) })}
              </p>
            )}
          </div>
        </div>
      </div>
      {actions && <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">{actions}</div>}
    </div>
  );
}
