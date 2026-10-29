import { AlertTriangle, Ban, CalendarClock, Check, CheckCheck, CheckCircle2, ChevronLeft, DoorClosed, DoorOpen, Hourglass, MapPin, Send, ShieldAlert, ShieldCheck, TimerOff, X, XCircle, type LucideIcon } from 'lucide-react-native';
import { useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import QRCode from 'qrcode';
import Svg, { Path, Rect } from 'react-native-svg';
import { countryName, type VisitDTO, type VisitStatus } from '@vms/shared';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors, flipX, ltr, space } from '@/lib/theme';
import { AppText, Badge, Card, Detail, DetailGrid, PressableCard, Row, TONES, type Tone } from './ui';

export const STATUS_META: Record<VisitStatus, { tone: Tone; icon: LucideIcon }> = {
  pending: { tone: 'amber', icon: Hourglass },
  approved: { tone: 'green', icon: CheckCircle2 },
  rejected: { tone: 'red', icon: XCircle },
  checked_in: { tone: 'blue', icon: DoorOpen },
  completed: { tone: 'slate', icon: CheckCheck },
  cancelled: { tone: 'neutral', icon: Ban },
  expired: { tone: 'orange', icon: TimerOff },
};

/** Status is always shown with an icon and text, never color alone. */
export function StatusBadge({ status, overdue }: { status: VisitStatus; overdue?: boolean }) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Row gap={6} style={{ flexWrap: 'wrap' }}>
      <Badge tone={meta.tone} icon={<Icon size={13} color={TONES[meta.tone].fg} />} label={t(`status.${status}`)} />
      {overdue ? <OverdueBadge /> : null}
    </Row>
  );
}

export function OverdueBadge() {
  const { t } = useI18n();
  return <Badge tone="red" icon={<AlertTriangle size={13} color={TONES.red.fg} />} label={t('status.overdue')} />;
}

export function DocBadge({ expired, label }: { expired: boolean; label?: string }) {
  const { t } = useI18n();
  return expired ? (
    <Badge tone="red" icon={<ShieldAlert size={13} color={TONES.red.fg} />} label={label ?? t('admin.identityExpired')} />
  ) : (
    <Badge tone="green" icon={<ShieldCheck size={13} color={TONES.green.fg} />} label={label ?? t('admin.identityValid')} />
  );
}

export function QrCodeView({ value, size = 240, label }: { value: string; size?: number; label: string }) {
  const { d, dim } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const quiet = 4;
    let path = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) path += `M${x + quiet},${y + quiet}h1v1h-1z`;
    return { d: path, dim: n + quiet * 2 };
  }, [value]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={size} height={size} viewBox={`0 0 ${dim} ${dim}`}>
        <Rect width={dim} height={dim} fill="#FFFFFF" />
        <Path d={d} fill={colors.navy900} />
      </Svg>
    </View>
  );
}

export function useVisitLabels() {
  const { t, locale } = useI18n();
  return {
    reason: (v: Pick<VisitDTO, 'reason' | 'reasonDetails'>) => (v.reason === 'other' && v.reasonDetails ? `${t('reasons.other')}: ${v.reasonDetails}` : t(`reasons.${v.reason}`)),
    gate: (g: { nameAr: string; nameEn: string } | null | undefined) => (g ? (locale === 'ar' ? g.nameAr : g.nameEn) : '—'),
    actor: (a: VisitDTO['submittedBy'] | null) => (!a ? '—' : a.type === 'visitor' ? t('common.visitorSelf') : a.type === 'system' ? t('common.system') : (a.name ?? t('common.staff'))),
    nationality: (code: string) => countryName(code, locale),
  };
}

export function VisitCard({ visit, onPress, showVisitor, footer }: { visit: VisitDTO; onPress?: () => void; showVisitor?: boolean; footer?: ReactNode }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const body = (
    <Row align="flex-start" gap={space.md}>
      <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: visit.isOverdue ? colors.red50 : colors.navy50, alignItems: 'center', justifyContent: 'center' }}>
        {visit.isOverdue ? <AlertTriangle size={22} color={colors.red700} /> : <CalendarClock size={22} color={colors.navy700} />}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Row style={{ flexWrap: 'wrap' }}>
          <StatusBadge status={visit.status} overdue={visit.isOverdue} />
          <AppText variant="small">{ltr(visit.reference)}</AppText>
        </Row>
        {showVisitor && visit.visitor ? <AppText variant="subheading">{visit.visitor.fullName}</AppText> : null}
        <AppText weight="bold">{fmt.dateTime(visit.requestedEntryAt)}</AppText>
        <Row gap={4} align="flex-start">
          <MapPin size={14} color={colors.muted} style={{ marginTop: 3 }} />
          <AppText variant="caption" style={{ flexShrink: 1 }}>
            {t('fields.villa')} {ltr(visit.villa.number)} · {labels.reason(visit)} · {fmt.duration(visit.durationMinutes)}
          </AppText>
        </Row>
        {footer}
      </View>
      {onPress ? <ChevronLeft size={20} color={colors.muted} style={[{ marginTop: 12 }, flipX()]} /> : null}
    </Row>
  );
  return onPress ? (
    <PressableCard onPress={onPress} accessibilityLabel={`${visit.reference} ${t(`status.${visit.status}`)}`}>
      {body}
    </PressableCard>
  ) : (
    <Card>{body}</Card>
  );
}

export function VisitDetails({ visit, audience = 'staff' }: { visit: VisitDTO; audience?: 'staff' | 'visitor' }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  return (
    <DetailGrid>
      <Detail label={t('fields.reference')} value={ltr(visit.reference)} />
      <Detail label={t('fields.villa')} value={ltr(visit.villa.number)} />
      <Detail label={t('fields.reason')} value={labels.reason(visit)} wide />
      <Detail label={t('fields.entryAt')} value={fmt.dateTime(visit.requestedEntryAt)} />
      <Detail label={t('fields.duration')} value={fmt.duration(visit.durationMinutes)} />
      <Detail label={t('fields.expectedExit')} value={fmt.dateTime(visit.expectedExitAt)} />
      {visit.entryWindowStart && visit.entryWindowEnd ? <Detail label={t('fields.entryWindow')} value={`${fmt.time(visit.entryWindowStart)} – ${fmt.time(visit.entryWindowEnd)}`} /> : null}
      <Detail label={t('fields.submittedAt')} value={fmt.dateTime(visit.submittedAt)} />
      {audience === 'staff' ? <Detail label={t('fields.submittedBy')} value={labels.actor(visit.submittedBy)} /> : null}
      {visit.decidedAt ? <Detail label={t('fields.decidedAt')} value={fmt.dateTime(visit.decidedAt)} /> : null}
      {audience === 'staff' && visit.decidedBy ? <Detail label={t('fields.decidedBy')} value={labels.actor(visit.decidedBy)} /> : null}
      {visit.rejectionReason ? <Detail label={t('fields.rejectionReason')} value={visit.rejectionReason} wide /> : null}
      {visit.checkedInAt ? <Detail label={t('fields.actualEntry')} value={`${fmt.dateTime(visit.checkedInAt)} · ${labels.gate(visit.checkInGate)}`} wide /> : null}
      {audience === 'staff' && visit.checkInBy ? <Detail label={t('fields.recordedBy')} value={labels.actor(visit.checkInBy)} /> : null}
      {visit.checkedOutAt ? <Detail label={t('fields.actualExit')} value={`${fmt.dateTime(visit.checkedOutAt)} · ${labels.gate(visit.checkOutGate)}`} wide /> : null}
      {(visit.overstayMinutes ?? 0) > 0 ? <Detail label={t('fields.overstay')} value={fmt.duration(visit.overstayMinutes!)} /> : null}
    </DetailGrid>
  );
}

export function VisitorIdentity({
  visitor,
}: {
  visitor: { fullName: string; documentType: 'national_id' | 'iqama'; documentNumber?: string; documentNumberMasked?: string; nationality: string; mobile?: string; mobileMasked?: string; documentExpiryDate: string; documentExpired: boolean };
}) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  return (
    <DetailGrid>
      <Detail label={t('fields.fullName')} value={<AppText variant="heading">{visitor.fullName}</AppText>} wide />
      <Detail label={t('fields.documentType')} value={t(`documentTypes.${visitor.documentType}`)} />
      <Detail label={t('fields.documentNumber')} value={<AppText weight="extrabold" style={{ fontSize: 17, letterSpacing: 1 }}>{ltr(visitor.documentNumber ?? visitor.documentNumberMasked)}</AppText>} />
      <Detail label={t('fields.nationality')} value={labels.nationality(visitor.nationality)} />
      <Detail label={t('fields.mobile')} value={ltr(visitor.mobile ?? visitor.mobileMasked)} />
      <Detail
        label={t('fields.documentExpiry')}
        wide
        value={
          <Row style={{ flexWrap: 'wrap' }}>
            <AppText weight="bold">{fmt.ymd(visitor.documentExpiryDate)}</AppText>
            <DocBadge expired={visitor.documentExpired} />
          </Row>
        }
      />
    </DetailGrid>
  );
}

type StepState = 'done' | 'current' | 'upcoming' | 'failed';

export function VisitProgress({ visit }: { visit: VisitDTO }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const s = visit.status;
  const decisionFailed = s === 'rejected' || (s === 'cancelled' && !visit.decidedAt);
  const steps: { label: string; state: StepState; time: string | null; icon: LucideIcon }[] = [
    { label: t('visitor.progress.submitted'), state: 'done', time: visit.submittedAt, icon: Send },
    {
      label: s === 'rejected' ? t('status.rejected') : s === 'cancelled' && !visit.decidedAt ? t('status.cancelled') : t('visitor.progress.decision'),
      state: decisionFailed ? 'failed' : visit.decidedAt ? 'done' : 'current',
      time: visit.decidedAt ?? visit.cancelledAt,
      icon: decisionFailed ? X : visit.decidedAt ? Check : Hourglass,
    },
    {
      label: s === 'expired' ? t('status.expired') : s === 'cancelled' && visit.decidedAt ? t('status.cancelled') : t('visitor.progress.entry'),
      state: visit.checkedInAt ? 'done' : s === 'expired' || (s === 'cancelled' && visit.decidedAt) ? 'failed' : s === 'approved' ? 'current' : 'upcoming',
      time: visit.checkedInAt ?? visit.expiredAt,
      icon: s === 'expired' ? TimerOff : DoorOpen,
    },
    { label: t('visitor.progress.exit'), state: visit.checkedOutAt ? 'done' : s === 'checked_in' ? 'current' : 'upcoming', time: visit.checkedOutAt, icon: DoorClosed },
  ];
  const tone = (st: StepState) =>
    st === 'done' ? { bg: colors.teal600, fg: colors.white } : st === 'current' ? { bg: colors.amber100, fg: colors.amber800 } : st === 'failed' ? { bg: colors.red100, fg: colors.red700 } : { bg: colors.slate100, fg: '#64748B' };
  return (
    <Row align="flex-start" gap={0}>
      {steps.map((step, i) => {
        const c = tone(step.state);
        const Icon = step.icon;
        return (
          <View key={i} style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={`${step.label} ${step.time ? fmt.time(step.time) : ''}`}>
            <Row gap={0} style={{ width: '100%' }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : steps[i - 1]!.state === 'done' ? colors.teal500 : colors.line }} />
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={16} color={c.fg} />
              </View>
              <View style={{ flex: 1, height: 2, backgroundColor: i === steps.length - 1 ? 'transparent' : step.state === 'done' ? colors.teal500 : colors.line }} />
            </Row>
            <AppText variant="small" weight="bold" align="center" style={{ color: colors.ink, marginTop: 6 }}>
              {step.label}
            </AppText>
            <AppText variant="small" align="center">
              {step.time ? fmt.time(step.time) : ' '}
            </AppText>
          </View>
        );
      })}
    </Row>
  );
}

/** Chronological history with outcomes, actual times and overstay flags. */
export function HistoryList({ visits, onPress }: { visits: VisitDTO[]; onPress?: (v: VisitDTO) => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  if (!visits.length) {
    return (
      <AppText variant="caption" align="center" style={{ paddingVertical: space.lg }}>
        {t('admin.noPreviousVisits')}
      </AppText>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      {visits.map((v, i) => (
        <PressableCard key={v.id} onPress={() => onPress?.(v)} style={{ padding: space.md }}>
          <Row align="flex-start" gap={space.md}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' }}>
              <AppText variant="small" weight="bold" style={{ color: colors.navy700 }}>
                {i + 1}
              </AppText>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <AppText weight="bold">{ltr(v.reference)}</AppText>
                <StatusBadge status={v.status} overdue={v.isOverdue} />
              </Row>
              <AppText variant="caption">
                {fmt.dateTime(v.requestedEntryAt)} · {t('fields.villa')} {ltr(v.villa.number)} · {labels.reason(v)}
              </AppText>
              {v.checkedInAt ? <AppText variant="small">{`${t('fields.actualEntry')}: ${fmt.dateTime(v.checkedInAt)}`}</AppText> : null}
              {v.checkedOutAt ? <AppText variant="small">{`${t('fields.actualExit')}: ${fmt.dateTime(v.checkedOutAt)}`}</AppText> : null}
              {v.rejectionReason ? <AppText variant="small" style={{ color: colors.red700 }}>{`${t('fields.rejectionReason')}: ${v.rejectionReason}`}</AppText> : null}
              {(v.overstayMinutes ?? 0) > 0 ? <Badge tone="red" icon={<AlertTriangle size={13} color={TONES.red.fg} />} label={t('admin.overstayFlag', { duration: fmt.duration(v.overstayMinutes!) })} /> : null}
            </View>
          </Row>
        </PressableCard>
      ))}
    </View>
  );
}
