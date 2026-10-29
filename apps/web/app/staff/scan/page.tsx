'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ScanConsole } from '@/components/scan-console';
import { LoadingRows } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/primitives';
import { useI18n } from '@/lib/i18n';

function ScanPageInner() {
  const { t } = useI18n();
  const search = useSearchParams();
  const action = search.get('action') === 'exit' ? 'exit' : 'entry';
  return (
    <div>
      <PageHeader title={t('scan.title')} />
      <ScanConsole initialAction={action} initialGateCode={search.get('gate')} initialVisitId={search.get('visit')} />
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <ScanPageInner />
    </Suspense>
  );
}
