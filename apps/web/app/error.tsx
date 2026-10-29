'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, Card } from '@/components/ui/primitives';
import { useI18n } from '@/lib/i18n';

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <Card className="flex flex-col items-center gap-4 p-8 text-center" role="alert">
        <span className="grid size-14 place-items-center rounded-2xl bg-red-50 text-red-700">
          <AlertTriangle className="size-7" aria-hidden />
        </span>
        <p className="text-lg font-bold text-ink">{t('errors.internal_error')}</p>
        <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} onClick={reset}>
          {t('common.retry')}
        </Button>
      </Card>
    </div>
  );
}
