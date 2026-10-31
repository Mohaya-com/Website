'use client';

import { AlertTriangle, CalendarCheck2, CheckCheck, ClipboardCheck, DoorOpen, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardSummaryDTO, Paginated, VisitDTO } from '@vms/shared';
import { GateConsole } from '@/components/gate-console';
import { StatCard, VisitRow } from '@/components/staff-widgets';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Badge, ButtonLink, Card, CardHeader } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useFormat, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

function useSummary() {
  return useQuery({ queryKey: ['dashboard', 'summary'], queryFn: () => api<DashboardSummaryDTO>('/dashboard/summary') });
}

function AdminDashboard() {
  const { t } = useI18n();
  const fmt = useFormat();
  const summary = useSummary();
  const pending = useQuery({ queryKey: ['queue', 'preview'], queryFn: () => api<Paginated<VisitDTO>>('/visits?status=pending&sort=entry_asc&pageSize=6') });
  const inside = useQuery({ queryKey: ['inside'], queryFn: () => api<{ items: VisitDTO[] }>('/visits/inside') });
  const overdue = inside.data?.items.filter((v) => v.isOverdue) ?? [];
  const s = summary.data;
  return (
    <div className="space-y-6">
      <GateConsole title={t('admin.dashboardTitle')} subtitle={`${t('admin.dashboardSubtitle')} · ${fmt.weekday(new Date())}`} />
      {summary.isError ? (
        <Card>
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label={t('admin.cards.pending')} value={s?.pending} icon={ClipboardCheck} tone="amber" href="/staff/requests" loading={summary.isLoading} />
          <StatCard label={t('admin.cards.approvedUpcoming')} value={s?.approvedUpcoming} icon={CalendarCheck2} tone="green" href="/staff/visits?status=approved" loading={summary.isLoading} />
          <StatCard label={t('admin.cards.inside')} value={s?.inside} icon={DoorOpen} tone="blue" href="/staff/inside" loading={summary.isLoading} />
          <StatCard label={t('admin.cards.completedToday')} value={s?.completedToday} icon={CheckCheck} tone="slate" href="/staff/visits?status=completed" loading={summary.isLoading} />
          <StatCard label={t('admin.cards.overdue')} value={s?.overdue} icon={AlertTriangle} tone="red" href="/staff/inside" loading={summary.isLoading} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={t('admin.pendingQueue')}
            icon={<ClipboardCheck className="size-5" aria-hidden />}
            actions={
              <ButtonLink href="/staff/requests" size="sm" variant="ghost">
                {t('common.showAll')}
              </ButtonLink>
            }
          />
          {pending.isLoading ? (
            <LoadingRows rows={3} />
          ) : pending.isError ? (
            <ErrorState error={pending.error} onRetry={() => void pending.refetch()} />
          ) : !pending.data?.items.length ? (
            <EmptyState icon={<CheckCheck className="size-7" aria-hidden />} title={t('admin.queueEmpty')} hint={t('admin.queueEmptyHint')} />
          ) : (
            <ul className="divide-y divide-line">
              {pending.data.items.map((v) => (
                <VisitRow key={v.id} visit={v} href={`/staff/requests/${v.id}`} />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={t('admin.insideTitle')}
            icon={<Users className="size-5" aria-hidden />}
            actions={
              overdue.length ? (
                <Badge tone="red" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
                  {overdue.length} {t('status.overdue')}
                </Badge>
              ) : undefined
            }
          />
          {inside.isLoading ? (
            <LoadingRows rows={3} />
          ) : !inside.data?.items.length ? (
            <EmptyState icon={<DoorOpen className="size-7" aria-hidden />} title={t('admin.insideEmpty')} />
          ) : (
            <ul className="divide-y divide-line">
              {[...inside.data.items]
                .sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue))
                .slice(0, 6)
                .map((v) => (
                  <VisitRow key={v.id} visit={v} href={`/staff/visits/${v.id}`} meta={<span className="text-muted">{t('security.insideSince', { time: fmt.time(v.checkedInAt) })}</span>} />
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function StaffHomePage() {
  const { t } = useI18n();
  const { data: session } = useSession();
  if (!session) return <LoadingRows rows={6} />;
  // Everyone lands on the gate dashboard; administrators also see the figures and the approval queue.
  return session.role === 'admin' ? <AdminDashboard /> : <GateConsole title={t('nav.dashboard')} />;
}
