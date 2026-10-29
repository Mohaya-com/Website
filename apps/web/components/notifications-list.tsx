'use client';

import { Bell, BellRing, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDTO, Paginated } from '@vms/shared';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { EmptyState, ErrorState, LoadingRows } from './ui/feedback';
import { Button, Card, PageHeader, cn } from './ui/primitives';
import { Pagination } from './ui/table';

/** Persistent in-app notification history. Text is rendered from type + non-sensitive parameters. */
export function NotificationsList({ hrefFor }: { hrefFor: (n: NotificationDTO) => string | null }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['notifications', page], queryFn: () => api<Paginated<NotificationDTO>>(`/notifications?page=${page}&pageSize=20`), placeholderData: keepPreviousData });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread'] });
    },
  });
  const markOne = (id: string) => {
    void api(`/notifications/${id}/read`, { method: 'POST' }).then(() => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread'] });
    });
  };

  return (
    <div>
      <PageHeader
        title={t('notifications.title')}
        actions={
          <Button variant="secondary" icon={<CheckCheck className="size-4" aria-hidden />} loading={markAll.isPending} onClick={() => markAll.mutate()}>
            {t('notifications.markAllRead')}
          </Button>
        }
      />
      <Card>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<Bell className="size-7" aria-hidden />} title={t('notifications.empty')} hint={t('notifications.emptyHint')} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data.items.map((n) => {
                const href = hrefFor(n);
                const title = t.dynamic(`notifications.types.${n.type}.title`, n.params);
                const body = t.dynamic(`notifications.types.${n.type}.body`, n.params);
                const content = (
                  <div className={cn('flex items-start gap-3 px-5 py-4 transition-colors', !n.readAt && 'bg-teal-50/50', href && 'hover:bg-navy-50/60')}>
                    <span className={cn('mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl', n.readAt ? 'bg-slate-100 text-slate-500' : 'bg-teal-600 text-white')}>
                      {n.readAt ? <Bell className="size-5" aria-hidden /> : <BellRing className="size-5" aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-bold text-ink">
                        {title}
                        {!n.readAt && <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold text-white">{t('notifications.unread')}</span>}
                      </p>
                      <p className="text-sm text-muted">{body}</p>
                      <p className="mt-1 text-xs text-muted">{fmt.dateTime(n.createdAt)}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {href ? (
                      <Link href={href} onClick={() => !n.readAt && markOne(n.id)} className="block">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
