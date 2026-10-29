'use client';

import { AlertTriangle, CloudOff, Info, RefreshCw, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import { isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, cn, Skeleton } from './primitives';

export function EmptyState({ icon, title, hint, action, className }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center animate-fade-in', className)}>
      <span className="grid size-14 place-items-center rounded-2xl bg-navy-50 text-navy-600">{icon ?? <SearchX className="size-7" aria-hidden />}</span>
      <div>
        <p className="text-base font-bold text-ink">{title}</p>
        {hint && <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useI18n();
  const network = isApiError(error) && error.isNetwork;
  const message = isApiError(error) ? t.dynamic(error.messageKey) : t('errors.internal_error');
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      <span className={cn('grid size-14 place-items-center rounded-2xl', network ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')}>
        {network ? <CloudOff className="size-7" aria-hidden /> : <AlertTriangle className="size-7" aria-hidden />}
      </span>
      <p className="max-w-md text-[15px] font-semibold text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

type BannerTone = 'info' | 'warning' | 'danger' | 'success' | 'dev';
const BANNER: Record<BannerTone, string> = {
  info: 'border-navy-100 bg-navy-50 text-navy-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  dev: 'border-violet-200 bg-violet-50 text-violet-900',
};

export function Banner({ tone = 'info', icon, title, children, className, action }: { tone?: BannerTone; icon?: ReactNode; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-xl border p-3.5 text-sm', BANNER[tone], className)}>
      <span className="mt-0.5 shrink-0">{icon ?? <Info className="size-5" aria-hidden />}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cn(Boolean(title) && 'mt-0.5', 'leading-relaxed')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
