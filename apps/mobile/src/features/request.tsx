import * as Clipboard from 'expo-clipboard';
import { CheckCircle2, ClipboardCopy, Pencil } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { computeExpectedExit, validateRequestTiming, type PublicConfigDTO, type VisitDTO, type VisitReason } from '@vms/shared';
import { ReasonPicker, SchedulePicker, VillaNumberInput, scheduleToEntry, type ScheduleValue } from '@/components/inputs';
import { AppText, Button, Card, Detail, DetailGrid, Field, Input, Row } from '@/components/ui';
import { StatusBadge } from '@/components/visit';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors, ltr, radius, space } from '@/lib/theme';

export interface VisitDraft {
  villaNumber: string;
  reason: VisitReason | null;
  reasonDetails: string;
  schedule: ScheduleValue;
  requestedGateId: string | null;
}

export type DraftErrors = Partial<Record<'villaNumber' | 'reason' | 'reasonDetails' | 'entry' | 'duration', string>>;

/** Mirrors the server rules for immediate feedback; the server re-validates everything. */
export function validateDraft(draft: VisitDraft, config: PublicConfigDTO | undefined, documentExpiryDate?: string | null): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.villaNumber.trim()) errors.villaNumber = 'validation.villaRequired';
  if (!draft.reason) errors.reason = 'validation.required';
  if (draft.reason === 'other' && draft.reasonDetails.trim().length < 3) errors.reasonDetails = 'validation.reasonDetailsRequired';
  const entry = scheduleToEntry(draft.schedule, config?.timezone ?? 'Asia/Riyadh');
  if (!entry) errors.entry = 'validation.invalidDate';
  else if (config) {
    const problem = validateRequestTiming({ requestedEntryAt: entry, durationMinutes: draft.schedule.durationMinutes, documentExpiryDate: documentExpiryDate ?? null, now: new Date(), settings: { ...config, entryWindowLateMinutes: 0 } });
    if (problem) {
      if (problem.field === 'durationMinutes') errors.duration = `validation.timing.${problem.error}`;
      else errors.entry = `validation.timing.${problem.error}`;
    }
  }
  return errors;
}

export function draftToBody(draft: VisitDraft, tz: string, clientRequestId: string) {
  return {
    villaNumber: draft.villaNumber.trim(),
    reason: draft.reason!,
    reasonDetails: draft.reasonDetails.trim() || null,
    requestedEntryAt: scheduleToEntry(draft.schedule, tz)!.toISOString(),
    durationMinutes: draft.schedule.durationMinutes,
    clientRequestId,
    requestedGateId: draft.requestedGateId,
  };
}

export function serverErrorsToDraft(fields: Record<string, string>): DraftErrors {
  return {
    ...(fields.villaNumber || fields.villaId ? { villaNumber: fields.villaNumber ?? fields.villaId } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ...(fields.reasonDetails ? { reasonDetails: fields.reasonDetails } : {}),
    ...(fields.requestedEntryAt ? { entry: fields.requestedEntryAt } : {}),
    ...(fields.durationMinutes ? { duration: fields.durationMinutes } : {}),
  };
}

/** RFC 4122 v4 id for idempotent submission (no crypto dependency needed on older engines). */
export function newClientRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function StepIndicator({ step, labels }: { step: number; labels: string[] }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: 6 }} accessibilityLabel={t('request.stepOf', { step: step + 1, total: labels.length })}>
      <AppText variant="small">{t('request.stepOf', { step: step + 1, total: labels.length })}</AppText>
      <Row gap={6}>
        {labels.map((l, i) => (
          <View key={l} style={{ flex: 1, gap: 4 }}>
            <View style={{ height: 5, borderRadius: 3, backgroundColor: i <= step ? colors.teal600 : colors.line }} />
            <AppText variant="small" weight={i === step ? 'bold' : 'medium'} style={{ color: i === step ? colors.navy900 : colors.muted }}>
              {l}
            </AppText>
          </View>
        ))}
      </Row>
    </View>
  );
}

export function VisitDetailsForm({ draft, onChange, errors, maxDurationMinutes }: { draft: VisitDraft; onChange: (d: VisitDraft) => void; errors: DraftErrors; maxDurationMinutes: number }) {
  const { t } = useI18n();
  return (
    <Card style={{ gap: space.xl }}>
      <VillaNumberInput value={draft.villaNumber} onChange={(villaNumber) => onChange({ ...draft, villaNumber })} error={errors.villaNumber} />
      <ReasonPicker value={draft.reason} onChange={(reason) => onChange({ ...draft, reason })} error={errors.reason} />
      {draft.reason === 'other' ? (
        <Field label={t('fields.reasonDetails')} required error={errors.reasonDetails}>
          <Input value={draft.reasonDetails} onChangeText={(reasonDetails) => onChange({ ...draft, reasonDetails })} placeholder={t('request.reasonOtherPlaceholder')} multiline maxLength={300} accessibilityLabel={t('fields.reasonDetails')} style={{ minHeight: 88, textAlignVertical: 'top', paddingTop: 12 }} />
        </Field>
      ) : null}
      <SchedulePicker value={draft.schedule} onChange={(schedule) => onChange({ ...draft, schedule })} maxDurationMinutes={maxDurationMinutes} errors={{ entry: errors.entry, duration: errors.duration }} />
    </Card>
  );
}

export function VisitReview({ draft, visitorBlock, onEdit }: { draft: VisitDraft; visitorBlock?: ReactNode; onEdit: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const entry = scheduleToEntry(draft.schedule, fmt.tz);
  return (
    <View style={{ gap: space.md }}>
      {visitorBlock}
      <Card style={{ gap: space.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="subheading">{t('request.stepDetails')}</AppText>
          <Button title={t('common.edit')} variant="ghost" size="sm" icon={<Pencil size={16} color={colors.navy800} />} onPress={onEdit} />
        </Row>
        <DetailGrid>
          <Detail label={t('fields.villa')} value={ltr(draft.villaNumber.trim() || '—')} />
          <Detail label={t('fields.reason')} value={draft.reason ? (draft.reason === 'other' ? `${t('reasons.other')}: ${draft.reasonDetails}` : t(`reasons.${draft.reason}`)) : '—'} />
          <Detail label={t('fields.entryAt')} value={entry ? fmt.dateTime(entry) : '—'} />
          <Detail label={t('fields.duration')} value={fmt.duration(draft.schedule.durationMinutes)} />
          <Detail label={t('fields.expectedExit')} value={entry ? fmt.dateTime(computeExpectedExit(entry, draft.schedule.durationMinutes)) : '—'} wide />
        </DetailGrid>
      </Card>
    </View>
  );
}

export function SubmittedView({ visit, actions }: { visit: VisitDTO; actions: ReactNode }) {
  const { t } = useI18n();
  return (
    <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.green50, alignItems: 'center', justifyContent: 'center' }}>
        <CheckCircle2 size={40} color={colors.green700} />
      </View>
      <AppText variant="heading" align="center" accessibilityRole="header">
        {t('request.submittedTitle')}
      </AppText>
      <AppText variant="caption" align="center">
        {t('request.submittedBody')}
      </AppText>
      <View style={{ alignSelf: 'stretch', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.navy200, backgroundColor: colors.navy50, borderRadius: radius.lg, padding: space.lg, alignItems: 'center', gap: 4 }}>
        <AppText variant="small" style={{ color: colors.navy700 }}>
          {t('request.referenceLabel')}
        </AppText>
        <AppText weight="extrabold" style={{ fontSize: 24, color: colors.navy900, letterSpacing: 1 }} selectable>
          {ltr(visit.reference)}
        </AppText>
        <Button title={t('common.copy')} variant="ghost" size="sm" icon={<ClipboardCopy size={16} color={colors.navy800} />} onPress={() => void Clipboard.setStringAsync(visit.reference)} />
      </View>
      <StatusBadge status={visit.status} />
      <View style={{ alignSelf: 'stretch', gap: space.sm }}>{actions}</View>
    </Card>
  );
}
