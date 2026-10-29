'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button, cn } from './primitives';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on small screens. */
  hideOnMobile?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, caption }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-start text-[14.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('sticky top-0 border-b border-line bg-slate-50 px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-muted', c.hideOnMobile && 'max-md:hidden', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              className={cn('group transition-colors', onRowClick && 'cursor-pointer hover:bg-navy-50/60 focus-visible:bg-navy-50')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('border-b border-line px-4 py-3.5 align-middle', c.hideOnMobile && 'max-md:hidden', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onPage }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label={t('common.pageOf', { page, total: totalPages })} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span className="ltr-nums">{t('common.showing', { from, to, total })}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronRight className="size-4 ltr:rotate-180" aria-hidden />}>
          {t('common.previous')}
        </Button>
        <span className="px-1 font-semibold text-ink">{t('common.pageOf', { page, total: totalPages })}</span>
        <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          {t('common.next')}
          <ChevronLeft className="size-4 ltr:rotate-180" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
