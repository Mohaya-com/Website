'use client';

import { CheckCircle2, ClipboardCopy, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  computeExpectedExit,
  validateRequestTiming,
  type PublicConfigDTO,
  type VisitDTO,
  type VisitReason,
} from '@vms/shared';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { ReasonPicker, ScheduleInput, VillaSelect, scheduleToEntry, useVillaOptions, type ScheduleValue } from './inputs';
import { StatusBadge } from './status';
import { Field, Textarea } from './ui/form';
import { Button, Card, DetailItem } from './ui/primitives';
import { useToast } from './ui/toast';

export interface VisitDraft {
  villaId: string;
  reason: VisitReason | null;
  reasonDetails: string;
  schedule: ScheduleValue;
  requestedGateId: string | null;
}

export type DraftErrors = Partial<Record<'villaId' | 'reason' | 'reasonDetails' | 'entry' | 'duration', string>>;

/** Client-side validation mirroring the server rules (the server re-validates everything). */
export function validateDraft(draft: VisitDraft, config: PublicConfigDTO | undefined, documentExpiryDate?: string | null): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.villaId) errors.villaId = 'validation.selectVilla';
  if (!draft.reason) errors.reason = 'validation.required';
  if (draft.reason === 'other' && draft.reasonDetails.trim().length < 3) errors.reasonDetails = 'validation.reasonDetailsRequired';
  const tz = config?.timezone ?? 'Asia/Riyadh';
  const entry = scheduleToEntry(draft.schedule, tz);
  if (!entry) errors.entry = 'validation.invalidDate';
  else if (config) {
    const problem = validateRequestTiming({
      requestedEntryAt: entry,
      durationMinutes: draft.schedule.durationMinutes,
      documentExpiryDate: documentExpiryDate ?? null,
      now: new Date(),
      settings: { ...config, entryWindowLateMinutes: 0 },
    });
    if (problem) {
      const key = `validation.timing.${problem.error}`;
      if (problem.field === 'durationMinutes') errors.duration = key;
      else errors.entry = key;
    }
  }
  return errors;
}

export function draftToBody(draft: VisitDraft, tz: string, clientRequestId: string) {
  const entry = scheduleToEntry(draft.schedule, tz)!;
  return {
    villaId: draft.villaId,
    reason: draft.reason!,
    reasonDetails: draft.reason === 'other' || draft.reasonDetails.trim() ? draft.reasonDetails.trim() || null : null,
    requestedEntryAt: entry.toISOString(),
    durationMinutes: draft.schedule.durationMinutes,
    clientRequestId,
    requestedGateId: draft.requestedGateId,
  };
}

/** Maps server field errors onto the form fields. */
export function serverErrorsToDraft(fields: Record<string, string>): DraftErrors {
  return {
    ...(fields.villaId ? { villaId: fields.villaId } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ...(fields.reasonDetails ? { reasonDetails: fields.reasonDetails } : {}),
    ...(fields.requestedEntryAt ? { entry: fields.requestedEntryAt } : {}),
    ...(fields.durationMinutes ? { duration: fields.durationMinutes } : {}),
  };
}

export function VisitDetailsForm({ draft, onChange, errors, maxDurationMinutes }: { draft: VisitDraft; onChange: (d: VisitDraft) => void; errors: DraftErrors; maxDurationMinutes: number }) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <VillaSelect value={draft.villaId} onChange={(villaId) => onChange({ ...draft, villaId })} error={errors.villaId} />
      <ReasonPicker value={draft.reason} onChange={(reason) => onChange({ ...draft, reason })} error={errors.reason} />
      {draft.reason === 'other' && (
        <Field label={t('fields.reasonDetails')} required error={errors.reasonDetails}>
          {(a) => <Textarea {...a} maxLength={300} placeholder={t('request.reasonOtherPlaceholder')} value={draft.reasonDetails} onChange={(e) => onChange({ ...draft, reasonDetails: e.target.value })} />}
        </Field>
      )}
      <ScheduleInput value={draft.schedule} onChange={(schedule) => onChange({ ...draft, schedule })} maxDurationMinutes={maxDurationMinutes} errors={{ entry: errors.entry, duration: errors.duration }} />
    </div>
  );
}

/** Read-only review shown before submission. */
export function VisitReview({ draft, visitorBlock, onEdit }: { draft: VisitDraft; visitorBlock?: ReactNode; onEdit: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const villas = useVillaOptions();
  const villa = villas.data?.items.find((v) => v.id === draft.villaId);
  const entry = scheduleToEntry(draft.schedule, fmt.tz);
  return (
    <div className="space-y-4">
      {visitorBlock}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-navy-900">{t('request.stepDetails')}</h3>
          <Button variant="ghost" size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit}>
            {t('common.edit')}
          </Button>
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DetailItem label={t('fields.villa')} value={villa?.number ?? '—'} mono />
          <DetailItem label={t('fields.reason')} value={draft.reason ? (draft.reason === 'other' ? `${t('reasons.other')}: ${draft.reasonDetails}` : t(`reasons.${draft.reason}`)) : '—'} />
          <DetailItem label={t('fields.entryAt')} value={entry ? fmt.dateTime(entry) : '—'} />
          <DetailItem label={t('fields.duration')} value={fmt.duration(draft.schedule.durationMinutes)} />
          <DetailItem label={t('fields.expectedExit')} value={entry ? fmt.dateTime(computeExpectedExit(entry, draft.schedule.durationMinutes)) : '—'} />
        </dl>
      </Card>
    </div>
  );
}

export function SubmittedConfirmation({ visit, actions }: { visit: VisitDTO; actions: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <Card className="p-6 text-center sm:p-8 animate-pop">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="size-9" aria-hidden />
      </span>
      <h2 className="mt-4 text-xl font-extrabold text-navy-900">{t('request.submittedTitle')}</h2>
      <p className="mt-1 text-[15px] text-muted">{t('request.submittedBody')}</p>
      <div className="mx-auto mt-5 max-w-xs rounded-2xl border border-dashed border-navy-200 bg-navy-50 p-4">
        <p className="text-xs font-semibold text-navy-700">{t('request.referenceLabel')}</p>
        <p className="mt-1 text-2xl font-extrabold tracking-wider text-navy-900 ltr-nums">{visit.reference}</p>
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-teal-700 hover:underline"
          onClick={() => {
            void navigator.clipboard?.writeText(visit.reference).then(() => toast(t('common.copied'), 'info'));
          }}
        >
          <ClipboardCopy className="size-4" aria-hidden />
          {t('common.copy')}
        </button>
      </div>
      <div className="mt-4 flex justify-center">
        <StatusBadge status={visit.status} />
      </div>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">{actions}</div>
    </Card>
  );
}

export function StepIndicator({ step, labels }: { step: number; labels: string[] }) {
  const { t } = useI18n();
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold text-muted">{t('request.stepOf', { step: step + 1, total: labels.length })}</p>
      <ol className="flex gap-2">
        {labels.map((label, i) => (
          <li key={label} className="flex-1" aria-current={i === step ? 'step' : undefined}>
            <span className={`block h-1.5 rounded-full transition-colors ${i <= step ? 'bg-teal-600' : 'bg-line'}`} />
            <span className={`mt-1.5 block text-xs font-semibold ${i === step ? 'text-navy-900' : 'text-muted'}`}>{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
