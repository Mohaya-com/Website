'use client';

import { Ban, CalendarClock, Check, ChevronLeft, CircleDot, DoorClosed, DoorOpen, Hourglass, MapPin, Send, TimerOff, X } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { countryName, type VisitDTO } from '@vms/shared';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { DocumentStatusBadge, StatusBadge } from './status';
import { cn, DetailItem } from './ui/primitives';

export function useVisitLabels() {
  const { t, locale } = useI18n();
  return {
    reason: (v: Pick<VisitDTO, 'reason' | 'reasonDetails'>) => (v.reason === 'other' && v.reasonDetails ? `${t('reasons.other')}: ${v.reasonDetails}` : t(`reasons.${v.reason}`)),
    gate: (g: { nameAr: string; nameEn: string } | null | undefined) => (g ? (locale === 'ar' ? g.nameAr : g.nameEn) : '—'),
    actor: (a: VisitDTO['submittedBy'] | null) => (!a ? '—' : a.type === 'visitor' ? t('common.visitorSelf') : a.type === 'system' ? t('common.system') : (a.name ?? t('common.staff'))),
    nationality: (code: string) => countryName(code, locale),
  };
}

/** Compact card used in lists (visitor "my visits", queues on small screens). */
export function VisitSummaryCard({ visit, href, showVisitor = false, footer }: { visit: VisitDTO; href?: string; showVisitor?: boolean; footer?: ReactNode }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const body = (
    <div className="flex items-start gap-4 p-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-50 text-navy-700">
        <CalendarClock className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={visit.status} overdue={visit.isOverdue} />
          <span className="text-xs font-semibold text-muted ltr-nums">{visit.reference}</span>
        </div>
        {showVisitor && visit.visitor && <p className="truncate text-[15px] font-bold text-ink">{visit.visitor.fullName}</p>}
        <p className="text-[15px] font-semibold text-ink">{fmt.dateTime(visit.requestedEntryAt)}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden />
            {t('fields.villa')} <span className="font-semibold text-ink ltr-nums">{visit.villa.number}</span>
          </span>
          <span>{labels.reason(visit)}</span>
          <span>{fmt.duration(visit.durationMinutes)}</span>
        </p>
        {footer}
      </div>
      {href && <ChevronLeft className="mt-3 size-5 shrink-0 text-muted ltr:rotate-180" aria-hidden />}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-card border border-line bg-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-raised">
      {body}
    </Link>
  ) : (
    <div className="rounded-card border border-line bg-white shadow-card">{body}</div>
  );
}

export function VisitDetailsGrid({ visit, audience = 'staff' }: { visit: VisitDTO; audience?: 'staff' | 'visitor' }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      <DetailItem label={t('fields.reference')} value={visit.reference} mono />
      <DetailItem label={t('fields.status')} value={<StatusBadge status={visit.status} overdue={visit.isOverdue} />} />
      <DetailItem label={t('fields.villa')} value={visit.villa.number} mono />
      <DetailItem label={t('fields.reason')} value={labels.reason(visit)} />
      <DetailItem label={t('fields.entryAt')} value={fmt.dateTime(visit.requestedEntryAt)} />
      <DetailItem label={t('fields.duration')} value={fmt.duration(visit.durationMinutes)} />
      <DetailItem label={t('fields.expectedExit')} value={fmt.dateTime(visit.expectedExitAt)} />
      {visit.entryWindowStart && visit.entryWindowEnd && (
        <DetailItem label={t('fields.entryWindow')} value={`${fmt.time(visit.entryWindowStart)} – ${fmt.time(visit.entryWindowEnd)} · ${fmt.date(visit.entryWindowStart)}`} />
      )}
      <DetailItem label={t('fields.submittedAt')} value={fmt.dateTime(visit.submittedAt)} />
      {audience === 'staff' && <DetailItem label={t('fields.submittedBy')} value={labels.actor(visit.submittedBy)} />}
      {visit.requestedGate && <DetailItem label={t('fields.requestedGate')} value={labels.gate(visit.requestedGate)} />}
      {visit.decidedAt && <DetailItem label={t('fields.decidedAt')} value={fmt.dateTime(visit.decidedAt)} />}
      {audience === 'staff' && visit.decidedBy && <DetailItem label={t('fields.decidedBy')} value={labels.actor(visit.decidedBy)} />}
      {visit.rejectionReason && <DetailItem className="sm:col-span-2" label={t('fields.rejectionReason')} value={visit.rejectionReason} />}
      {visit.cancelledAt && <DetailItem label={t('status.cancelled')} value={fmt.dateTime(visit.cancelledAt)} />}
      {visit.cancelReason && visit.cancelReason !== 'replaced_by_modification' && visit.cancelReason !== 'window_elapsed' && <DetailItem label={t('fields.cancelReason')} value={visit.cancelReason} />}
      {visit.checkedInAt && <DetailItem label={t('fields.actualEntry')} value={`${fmt.dateTime(visit.checkedInAt)} · ${labels.gate(visit.checkInGate)}`} />}
      {audience === 'staff' && visit.checkInBy && <DetailItem label={`${t('fields.recordedBy')} (${t('scan.entry')})`} value={labels.actor(visit.checkInBy)} />}
      {visit.checkedOutAt && <DetailItem label={t('fields.actualExit')} value={`${fmt.dateTime(visit.checkedOutAt)} · ${labels.gate(visit.checkOutGate)}`} />}
      {audience === 'staff' && visit.checkOutBy && <DetailItem label={`${t('fields.recordedBy')} (${t('scan.exit')})`} value={labels.actor(visit.checkOutBy)} />}
      {(visit.overstayMinutes ?? 0) > 0 && <DetailItem label={t('fields.overstay')} value={<span className="text-red-700">{fmt.duration(visit.overstayMinutes!)}</span>} />}
    </dl>
  );
}

export function VisitorIdentityGrid({
  visitor,
}: {
  visitor: { fullName: string; documentType: 'national_id' | 'iqama'; documentNumber?: string; documentNumberMasked?: string; nationality: string; mobile?: string; mobileMasked?: string; documentExpiryDate: string; documentExpired: boolean };
}) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      <DetailItem className="sm:col-span-2" label={t('fields.fullName')} value={<span className="text-lg">{visitor.fullName}</span>} />
      <DetailItem label={t('fields.documentType')} value={t(`documentTypes.${visitor.documentType}`)} />
      <DetailItem label={t('fields.documentNumber')} value={visitor.documentNumber ?? visitor.documentNumberMasked} mono />
      <DetailItem label={t('fields.nationality')} value={labels.nationality(visitor.nationality)} />
      <DetailItem label={t('fields.mobile')} value={visitor.mobile ?? visitor.mobileMasked} mono />
      <DetailItem
        className="sm:col-span-2"
        label={t('fields.documentExpiry')}
        value={
          <span className="flex flex-wrap items-center gap-2">
            {fmt.ymd(visitor.documentExpiryDate)} <span className="text-xs font-normal text-muted">({t('calendars.gregorian')})</span>
            <DocumentStatusBadge expired={visitor.documentExpired} />
          </span>
        }
      />
    </dl>
  );
}

type StepState = 'done' | 'current' | 'upcoming' | 'failed';

/** Visual progress of a visit: submitted → decision → entry → exit. Uses icons and text, not color alone. */
export function VisitProgress({ visit }: { visit: VisitDTO }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = visit.status;
  const decisionFailed = s === 'rejected' || (s === 'cancelled' && !visit.decidedAt);
  const steps: { label: string; state: StepState; time: string | null; icon: ReactNode }[] = [
    { label: t('visitor.progress.submitted'), state: 'done', time: visit.submittedAt, icon: <Send className="size-4" aria-hidden /> },
    {
      label: s === 'rejected' ? t('status.rejected') : s === 'cancelled' && !visit.decidedAt ? t('status.cancelled') : t('visitor.progress.decision'),
      state: decisionFailed ? 'failed' : visit.decidedAt ? 'done' : 'current',
      time: visit.decidedAt ?? visit.cancelledAt,
      icon: decisionFailed ? <X className="size-4" aria-hidden /> : visit.decidedAt ? <Check className="size-4" aria-hidden /> : <Hourglass className="size-4" aria-hidden />,
    },
    {
      label: s === 'expired' ? t('status.expired') : s === 'cancelled' && visit.decidedAt ? t('status.cancelled') : t('visitor.progress.entry'),
      state: visit.checkedInAt ? 'done' : s === 'expired' || (s === 'cancelled' && visit.decidedAt) ? 'failed' : s === 'approved' ? 'current' : 'upcoming',
      time: visit.checkedInAt ?? visit.expiredAt ?? (visit.decidedAt ? visit.cancelledAt : null),
      icon: s === 'expired' ? <TimerOff className="size-4" aria-hidden /> : s === 'cancelled' && visit.decidedAt ? <Ban className="size-4" aria-hidden /> : <DoorOpen className="size-4" aria-hidden />,
    },
    {
      label: t('visitor.progress.exit'),
      state: visit.checkedOutAt ? 'done' : s === 'checked_in' ? 'current' : 'upcoming',
      time: visit.checkedOutAt,
      icon: <DoorClosed className="size-4" aria-hidden />,
    },
  ];
  return (
    <ol className="grid grid-cols-4 gap-1">
      {steps.map((step, i) => (
        <li key={i} aria-current={step.state === 'current' ? 'step' : undefined} className="flex flex-col items-center text-center">
          <div className="flex w-full items-center">
            <span className={cn('h-0.5 flex-1', i === 0 ? 'opacity-0' : steps[i - 1]!.state === 'done' ? 'bg-teal-500' : 'bg-line')} />
            <span
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full ring-4 ring-white',
                step.state === 'done' && 'bg-teal-600 text-white',
                step.state === 'current' && 'bg-amber-100 text-amber-800 ring-amber-50',
                step.state === 'failed' && 'bg-red-100 text-red-800',
                step.state === 'upcoming' && 'bg-slate-100 text-slate-500',
              )}
            >
              {step.state === 'current' ? <CircleDot className="size-4 animate-pulse" aria-hidden /> : step.icon}
            </span>
            <span className={cn('h-0.5 flex-1', i === steps.length - 1 ? 'opacity-0' : step.state === 'done' ? 'bg-teal-500' : 'bg-line')} />
          </div>
          <span className="mt-2 text-xs font-bold text-ink">{step.label}</span>
          <span className="text-[11px] text-muted">{step.time ? fmt.time(step.time) : ''}</span>
        </li>
      ))}
    </ol>
  );
}
