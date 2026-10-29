'use client';

import { LogIn, LogOut, Printer } from 'lucide-react';
import { use } from 'react';
import { buildGateUrl } from '@vms/shared';
import { QrCode } from '@/components/qr-code';
import { ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Button } from '@/components/ui/primitives';
import { useGates } from '@/components/visit-filters';
import { usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** Printable gate posters (entry and exit). They identify the gate and action only. */
export default function GatePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const gates = useGates(true);
  const { data: config } = usePublicConfig();
  if (gates.isLoading) return <LoadingRows />;
  const gate = gates.data?.items.find((g) => g.id === id);
  if (!gate) return <ErrorState error={null} />;
  const origin = config?.appOrigin ?? window.location.origin;
  const compound = config ? (locale === 'ar' ? config.compoundNameAr : config.compoundNameEn) : '';
  const actions = (['entry', 'exit'] as const).filter((a) => (a === 'entry' ? gate.supportsEntry : gate.supportsExit));
  return (
    <div>
      <div className="no-print mb-6 flex justify-end">
        <Button icon={<Printer className="size-5" aria-hidden />} onClick={() => window.print()}>
          {t('common.print')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {actions.map((a) => {
          const Icon = a === 'entry' ? LogIn : LogOut;
          return (
            <section key={a} className="print-page flex flex-col items-center rounded-3xl border-2 border-navy-900 bg-white p-8 text-center">
              <p className="text-sm font-bold text-teal-700">{compound}</p>
              <h1 className="mt-1 text-3xl font-extrabold text-navy-900">{gate.nameAr}</h1>
              <p className="text-lg font-semibold text-muted" dir="ltr">
                {gate.nameEn}
              </p>
              <div className="mt-5 inline-flex items-center gap-3 rounded-full bg-navy-900 px-6 py-2.5 text-2xl font-extrabold text-white">
                <Icon className="size-7 rtl:-scale-x-100" aria-hidden />
                {a === 'entry' ? 'دخول · Entry' : 'خروج · Exit'}
              </div>
              <div className="mt-6 rounded-2xl border border-line p-4">
                <QrCode value={buildGateUrl(origin, gate.code, a)} size={300} label={`${gate.nameEn} ${a}`} />
              </div>
              <p className="mt-5 text-lg font-bold text-navy-900">{a === 'entry' ? 'امسح الرمز لطلب زيارة أو للدخول' : 'امسح الرمز عند الخروج واعرض تصريحك لموظف الأمن'}</p>
              <p className="text-base text-muted" dir="ltr">
                {a === 'entry' ? 'Scan to request a visit or to enter' : 'Scan when leaving and show your pass to security'}
              </p>
              <p className="mt-6 max-w-sm text-xs text-muted">{t('admin.gateQrNote')}</p>
            </section>
          );
        })}
      </div>
    </div>
  );
}
