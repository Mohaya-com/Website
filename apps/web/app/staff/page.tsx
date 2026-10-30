'use client';

import { AlertTriangle, CalendarCheck2, CheckCheck, ClipboardCheck, DoorOpen, LogIn, LogOut, ScanLine, UserPlus, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardSummaryDTO, GateEventDTO, Paginated, VisitDTO } from '@vms/shared';
import { GateConsole } from '@/components/gate-console';
import { StatCard, VisitRow } from '@/components/staff-widgets';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Badge, ButtonLink, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { useVisitLabels } from '@/components/visit-views';
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
      <PageHeader
        title={t('admin.dashboardTitle')}
        subtitle={`${t('admin.dashboardSubtitle')} · ${fmt.weekday(new Date())}`}
        actions={
          <>
            <ButtonLink href="/staff/scan" variant="secondary" icon={<ScanLine className="size-5" aria-hidden />}>
              {t('nav.scan')}
            </ButtonLink>
            <ButtonLink href="/staff/register" variant="accent" icon={<UserPlus className="size-5" aria-hidden />}>
              {t('nav.register')}
            </ButtonLink>
          </>
        }
      />
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

function SecurityHome() {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const summary = useSummary();
  const expected = useQuery({ queryKey: ['expected'], queryFn: () => api<{ items: VisitDTO[] }>('/visits/expected') });
  const events = useQuery({ queryKey: ['gate-events', 'recent'], queryFn: () => api<Paginated<GateEventDTO>>('/gate-events?pageSize=8') });
  const s = summary.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t('security.homeTitle')} subtitle={t('security.homeSubtitle')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ButtonLink href="/staff/scan?action=entry" size="lg" variant="accent" className="h-20 text-lg" icon={<LogIn className="size-6 rtl:-scale-x-100" aria-hidden />}>
          {t('security.quickScanEntry')}
        </ButtonLink>
        <ButtonLink href="/staff/scan?action=exit" size="lg" className="h-20 text-lg" icon={<LogOut className="size-6 rtl:-scale-x-100" aria-hidden />}>
          {t('security.quickScanExit')}
        </ButtonLink>
        <ButtonLink href="/staff/register" size="lg" variant="secondary" className="h-20 text-lg" icon={<UserPlus className="size-6" aria-hidden />}>
          {t('security.registerVisitor')}
        </ButtonLink>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('admin.cards.inside')} value={s?.inside} icon={DoorOpen} tone="blue" href="/staff/inside" loading={summary.isLoading} />
        <StatCard label={t('admin.cards.overdue')} value={s?.overdue} icon={AlertTriangle} tone="red" href="/staff/inside" loading={summary.isLoading} />
        <StatCard label={t('admin.cards.expectedToday')} value={s?.expectedToday} icon={CalendarCheck2} tone="green" loading={summary.isLoading} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('security.expectedToday')} icon={<CalendarCheck2 className="size-5" aria-hidden />} />
          {expected.isLoading ? (
            <LoadingRows rows={3} />
          ) : !expected.data?.items.length ? (
            <EmptyState title={t('security.expectedEmpty')} />
          ) : (
            <ul className="divide-y divide-line">
              {expected.data.items.map((v) => (
                <VisitRow key={v.id} visit={v} href={`/staff/visits/${v.id}`} meta={<span className="font-semibold text-ink ltr-nums">{fmt.time(v.entryWindowStart)} – {fmt.time(v.entryWindowEnd)}</span>} />
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader
            title={t('security.recentEvents')}
            icon={<ScanLine className="size-5" aria-hidden />}
            actions={
              <ButtonLink href="/staff/log" size="sm" variant="ghost">
                {t('common.showAll')}
              </ButtonLink>
            }
          />
          {events.isLoading ? (
            <LoadingRows rows={3} />
          ) : !events.data?.items.length ? (
            <EmptyState title={t('security.logEmpty')} />
          ) : (
            <ul className="divide-y divide-line">
              {events.data.items.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={`grid size-9 place-items-center rounded-full ${e.type === 'entry' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                    {e.type === 'entry' ? <LogIn className="size-4 rtl:-scale-x-100" aria-hidden /> : <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{e.visit.visitorName}</span>
                    <span className="block text-xs text-muted">
                      {t(e.type === 'entry' ? 'scan.entry' : 'scan.exit')} · {labels.gate(e.gate)} · {t('fields.villa')} <span className="ltr-nums">{e.visit.villaNumber}</span>
                    </span>
                  </span>
                  <span className="text-sm text-muted ltr-nums">{fmt.time(e.recordedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function StaffHomePage() {
  const { data: session } = useSession();
  if (!session) return <LoadingRows rows={6} />;
  // Security staff land directly on the gate screen (entry with an ID photo, one-tap exit).
  return session.role === 'admin' ? <AdminDashboard /> : <GateConsole />;
}
