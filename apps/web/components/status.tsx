'use client';

import { AlertTriangle, Ban, CheckCheck, CheckCircle2, DoorOpen, Hourglass, ShieldAlert, ShieldCheck, TimerOff, XCircle, type LucideIcon } from 'lucide-react';
import type { VisitStatus } from '@vms/shared';
import { useI18n } from '@/lib/i18n';
import { Badge, type Tone } from './ui/primitives';

export const STATUS_META: Record<VisitStatus, { tone: Tone; icon: LucideIcon }> = {
  pending: { tone: 'amber', icon: Hourglass },
  approved: { tone: 'green', icon: CheckCircle2 },
  rejected: { tone: 'red', icon: XCircle },
  checked_in: { tone: 'blue', icon: DoorOpen },
  completed: { tone: 'slate', icon: CheckCheck },
  cancelled: { tone: 'neutral', icon: Ban },
  expired: { tone: 'orange', icon: TimerOff },
};

/** Status is always communicated with an icon and text, never color alone. */
export function StatusBadge({ status, overdue }: { status: VisitStatus; overdue?: boolean }) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={meta.tone} icon={<Icon className="size-3.5" aria-hidden />}>
        {t(`status.${status}`)}
      </Badge>
      {overdue && <OverdueBadge />}
    </span>
  );
}

export function OverdueBadge() {
  const { t } = useI18n();
  return (
    <Badge tone="red" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
      {t('status.overdue')}
    </Badge>
  );
}

export function DocumentStatusBadge({ expired, label }: { expired: boolean; label?: string }) {
  const { t } = useI18n();
  return expired ? (
    <Badge tone="red" icon={<ShieldAlert className="size-3.5" aria-hidden />}>
      {label ?? t('admin.identityExpired')}
    </Badge>
  ) : (
    <Badge tone="green" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
      {label ?? t('admin.identityValid')}
    </Badge>
  );
}
