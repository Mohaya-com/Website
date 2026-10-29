import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AlertTriangle, CalendarCheck2, CheckCheck, ClipboardCheck, DoorOpen, ScanLine, UserPlus } from 'lucide-react-native';
import type { DashboardSummaryDTO, Paginated, VisitDTO } from '@vms/shared';
import { LiveDot, NotificationBell } from '@/components/tabs';
import { AppText, Button, EmptyState, ErrorState, Loading, Row, Screen, ScreenTitle, SectionTitle } from '@/components/ui';
import { VisitCard } from '@/components/visit';
import { InsideList, StatCard, StatGrid } from '@/features/staff';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors } from '@/lib/theme';

export default function AdminDashboard() {
  const { t } = useI18n();
  const fmt = useFormat();
  const summary = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: () => api<DashboardSummaryDTO>('/dashboard/summary') });
  const pending = useQuery({ queryKey: ['queue', 'preview'], queryFn: () => api<Paginated<VisitDTO>>('/visits?status=pending&sort=entry_asc&pageSize=4') });
  const s = summary.data;
  return (
    <Screen refreshing={summary.isRefetching} onRefresh={() => void Promise.all([summary.refetch(), pending.refetch()])}>
      <Row style={{ justifyContent: 'space-between' }}>
        <LiveDot />
        <NotificationBell />
      </Row>
      <ScreenTitle title={t('admin.dashboardTitle')} subtitle={fmt.weekday(new Date())} />
      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <StatGrid>
          <StatCard label={t('admin.cards.pending')} value={s?.pending} icon={ClipboardCheck} tone="amber" loading={summary.isLoading} onPress={() => router.push('/(admin)/requests')} />
          <StatCard label={t('admin.cards.approvedUpcoming')} value={s?.approvedUpcoming} icon={CalendarCheck2} tone="green" loading={summary.isLoading} onPress={() => router.push({ pathname: '/staff/history', params: { status: 'approved' } })} />
          <StatCard label={t('admin.cards.inside')} value={s?.inside} icon={DoorOpen} tone="blue" loading={summary.isLoading} onPress={() => router.push('/staff/inside')} />
          <StatCard label={t('admin.cards.completedToday')} value={s?.completedToday} icon={CheckCheck} tone="slate" loading={summary.isLoading} onPress={() => router.push({ pathname: '/staff/history', params: { status: 'completed' } })} />
          <StatCard label={t('admin.cards.overdue')} value={s?.overdue} icon={AlertTriangle} tone="red" loading={summary.isLoading} onPress={() => router.push('/staff/inside')} />
          <StatCard label={t('admin.cards.expectedToday')} value={s?.expectedToday} icon={CalendarCheck2} tone="teal" loading={summary.isLoading} />
        </StatGrid>
      )}
      <Row>
        <Button title={t('nav.scan')} variant="secondary" icon={<ScanLine size={18} color={colors.navy900} />} onPress={() => router.push('/staff/scan')} style={{ flex: 1 }} />
        <Button title={t('nav.register')} variant="accent" icon={<UserPlus size={18} color={colors.white} />} onPress={() => router.push('/staff/register')} style={{ flex: 1 }} />
      </Row>
      <SectionTitle title={t('admin.pendingQueue')} right={<AppText weight="bold" style={{ color: colors.teal700 }} onPress={() => router.push('/(admin)/requests')}>{t('common.showAll')}</AppText>} />
      {pending.isLoading ? (
        <Loading />
      ) : !pending.data?.items.length ? (
        <EmptyState icon={<CheckCheck size={28} color={colors.navy600} />} title={t('admin.queueEmpty')} hint={t('admin.queueEmptyHint')} />
      ) : (
        pending.data.items.map((v) => <VisitCard key={v.id} visit={v} showVisitor onPress={() => router.push(`/staff/review/${v.id}`)} />)
      )}
      <SectionTitle title={t('admin.insideTitle')} right={<AppText weight="bold" style={{ color: colors.teal700 }} onPress={() => router.push('/staff/inside')}>{t('common.showAll')}</AppText>} />
      <InsideList limit={3} />
    </Screen>
  );
}
