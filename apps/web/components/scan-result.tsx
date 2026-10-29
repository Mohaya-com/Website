'use client';

import { CheckCircle2, CircleSlash, LogIn, LogOut, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { SUCCESS_SCAN_CODES, type ScanResultDTO } from '@vms/shared';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { DocumentStatusBadge } from './status';
import { Checkbox } from './ui/form';
import { Button, Card, DetailItem, cn } from './ui/primitives';
import { useVisitLabels } from './visit-views';

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return null;
  return (
    <li className={cn('flex items-center gap-2 text-sm font-semibold', ok ? 'text-emerald-800' : 'text-red-800')}>
      {ok ? <CheckCircle2 className="size-4.5" aria-hidden /> : <XCircle className="size-4.5" aria-hidden />}
      {label}
    </li>
  );
}

/** Verification panel: the server's decision, the visitor's identity for visual comparison, and explicit confirmation. */
export function ScanResultPanel({
  result,
  onConfirm,
  confirming,
  onReset,
  online,
}: {
  result: ScanResultDTO;
  onConfirm: (identityConfirmed: boolean) => void;
  confirming: boolean;
  onReset: () => void;
  online: boolean;
}) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const [identityChecked, setIdentityChecked] = useState(false);
  const success = SUCCESS_SCAN_CODES.includes(result.code);
  const recorded = result.code === 'entry_recorded' || result.code === 'exit_recorded';
  const canConfirm = result.ok && !recorded;
  const v = result.visit;
  const p = result.visitor;
  const Icon = recorded ? CheckCircle2 : success ? (result.action === 'entry' ? LogIn : LogOut) : result.code === 'identity_not_confirmed' ? ShieldAlert : CircleSlash;

  return (
    <div className="space-y-4 animate-slide-up" aria-live="assertive">
      <div
        role={success ? 'status' : 'alert'}
        className={cn(
          'flex items-center gap-4 rounded-2xl p-5 text-white shadow-raised',
          recorded ? 'bg-emerald-700' : success ? 'bg-teal-700' : 'bg-red-700',
        )}
      >
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/15">
          <Icon className={cn('size-8', (Icon === LogIn || Icon === LogOut) && 'rtl:-scale-x-100')} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/80">
            {t(result.action === 'entry' ? 'scan.entry' : 'scan.exit')} · {labels.gate(result.gate)}
          </p>
          <p className="text-lg font-extrabold leading-snug">{t(`scan.codes.${result.code}`)}</p>
          {result.recordedAt && <p className="text-sm text-white/85 ltr-nums">{fmt.dateTime(result.recordedAt)}</p>}
        </div>
      </div>

      {(result.checks.withinWindow !== null || result.checks.documentValid !== null || !result.ok) && v && (
        <ul className="grid gap-2 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2">
          <Check ok={result.checks.approved} label={t('scan.checks.approved')} />
          <Check ok={result.checks.passActive} label={t('scan.checks.pass')} />
          <Check ok={result.checks.withinWindow} label={t('scan.checks.window')} />
          <Check ok={result.checks.documentValid} label={t('scan.checks.document')} />
        </ul>
      )}

      {p && (
        <Card className="p-5">
          <h3 className="mb-3 font-bold text-navy-900">{t('scan.verifyIdentityTitle')}</h3>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailItem className="sm:col-span-2" label={t('fields.fullName')} value={<span className="text-xl">{p.fullName}</span>} />
            <DetailItem label={t('fields.documentType')} value={t(`documentTypes.${p.documentType}`)} />
            <DetailItem label={t('fields.documentNumber')} value={<span className="text-lg tracking-wider">{p.documentNumber}</span>} mono />
            <DetailItem label={t('fields.nationality')} value={labels.nationality(p.nationality)} />
            <DetailItem
              label={t('fields.documentExpiry')}
              value={
                <span className="flex flex-wrap items-center gap-2">
                  {fmt.ymd(p.documentExpiryDate)} <DocumentStatusBadge expired={p.documentExpired} />
                </span>
              }
            />
          </dl>
        </Card>
      )}

      {v && (
        <Card className="p-5">
          <h3 className="mb-3 font-bold text-navy-900">{t('scan.visitDetails')}</h3>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <DetailItem label={t('fields.reference')} value={v.reference} mono />
            <DetailItem label={t('fields.villa')} value={<span className="text-lg">{v.villa.number}</span>} mono />
            <DetailItem label={t('fields.reason')} value={labels.reason(v)} />
            {v.entryWindowStart && v.entryWindowEnd && <DetailItem label={t('fields.entryWindow')} value={`${fmt.time(v.entryWindowStart)} – ${fmt.time(v.entryWindowEnd)}`} />}
            <DetailItem label={t('fields.expectedExit')} value={fmt.dateTime(v.expectedExitAt)} />
            {v.checkedInAt && <DetailItem label={t('fields.actualEntry')} value={fmt.dateTime(v.checkedInAt)} />}
          </dl>
        </Card>
      )}

      {canConfirm && (
        <div className="space-y-3 rounded-2xl border-2 border-teal-200 bg-teal-50/60 p-4">
          {result.action === 'entry' && <Checkbox checked={identityChecked} onChange={setIdentityChecked} label={t('scan.identityCheck')} />}
          <Button
            size="lg"
            block
            variant={result.action === 'entry' ? 'success' : 'primary'}
            className="h-14 text-lg"
            loading={confirming}
            disabled={!online || (result.action === 'entry' && !identityChecked)}
            onClick={() => onConfirm(identityChecked)}
            icon={result.action === 'entry' ? <LogIn className="size-6 rtl:-scale-x-100" aria-hidden /> : <LogOut className="size-6 rtl:-scale-x-100" aria-hidden />}
          >
            {confirming ? t('scan.recording') : result.action === 'entry' ? t('scan.confirmEntry') : t('scan.confirmExit')}
          </Button>
          {!online && <p className="text-sm font-semibold text-amber-800">{t('scan.offlineBlocked')}</p>}
        </div>
      )}

      <Button variant="secondary" size="lg" block icon={<RotateCcw className="size-5" aria-hidden />} onClick={onReset}>
        {t('scan.scanAgain')}
      </Button>
    </div>
  );
}
