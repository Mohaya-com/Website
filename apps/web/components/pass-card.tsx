'use client';

import { EyeOff, Info, Sun } from 'lucide-react';
import type { PassDTO } from '@vms/shared';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { QrCode } from './qr-code';
import { StatusBadge } from './status';

/** The approved visit pass. The QR encodes only a random token — never personal data. */
export function PassCard({ pass }: { pass: PassDTO }) {
  const { t } = useI18n();
  const fmt = useFormat();
  return (
    <div id="pass" className="mx-auto max-w-sm overflow-hidden rounded-3xl border border-line bg-white shadow-raised animate-pop">
      <div className="bg-navy-900 px-6 pb-5 pt-6 text-center text-white">
        <p className="text-sm font-semibold text-teal-200">{t('pass.title')}</p>
        <p className="mt-1 text-lg font-extrabold">{pass.visitorName}</p>
        <div className="mt-2 flex justify-center">
          <StatusBadge status={pass.status} />
        </div>
      </div>
      <div className="relative flex justify-center bg-white px-6 pt-6">
        <div className="rounded-2xl border border-line p-3">
          <QrCode value={pass.qrValue} size={248} label={t('pass.showAtGate')} />
        </div>
      </div>
      <div className="space-y-4 px-6 pb-6 pt-4 text-center">
        <p className="text-[15px] font-bold text-navy-900">{pass.status === 'checked_in' ? t('pass.inside') : t('pass.showAtGate')}</p>
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-navy-50 p-3 text-start">
          <div>
            <p className="text-xs text-navy-700">{t('fields.reference')}</p>
            <p className="font-extrabold text-navy-900 ltr-nums">{pass.reference}</p>
          </div>
          <div>
            <p className="text-xs text-navy-700">{t('fields.villa')}</p>
            <p className="font-extrabold text-navy-900 ltr-nums">{pass.villaNumber}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-navy-700">{t('pass.validWindow')}</p>
            <p className="font-bold text-navy-900">
              {fmt.date(pass.entryWindowStart)} · <span className="ltr-nums">{fmt.time(pass.entryWindowStart)} – {fmt.time(pass.entryWindowEnd)}</span>
            </p>
          </div>
        </div>
        <ul className="space-y-1.5 text-start text-xs text-muted">
          <li className="flex items-center gap-2">
            <Sun className="size-4 shrink-0" aria-hidden />
            {t('pass.brightness')}
          </li>
          <li className="flex items-center gap-2">
            <EyeOff className="size-4 shrink-0" aria-hidden />
            {t('pass.noPersonalData')}
          </li>
          <li className="flex items-center gap-2">
            <Info className="size-4 shrink-0" aria-hidden />
            {t('pass.manualFallback')}
          </li>
        </ul>
      </div>
    </div>
  );
}
