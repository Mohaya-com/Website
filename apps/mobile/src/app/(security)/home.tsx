import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AlertTriangle, CalendarCheck2, DoorOpen, LogIn, LogOut, Settings2, UserPlus } from 'lucide-react-native';
import { View } from 'react-native';
import type { DashboardSummaryDTO, VisitDTO } from '@vms/shared';
import { LiveDot, NotificationBell } from '@/components/tabs';
import { AppText, Button, EmptyState, IconButton, Loading, Row, Screen, ScreenTitle, SectionTitle } from '@/components/ui';
import { VisitCard } from '@/components/visit';
import { StatCard, StatGrid } from '@/features/staff';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, flipX, space } from '@/lib/theme';

export default function SecurityHome() {
  const { t } = useI18n();
  const fmt = useFormat();
  const { session } = useSession();
  const summary = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: () => api<DashboardSummaryDTO>('/dashboard/summary') });
  const expected = useQuery({ queryKey: ['expected'], queryFn: () => api<{ items: VisitDTO[] }>('/visits/expected') });
  const s = summary.data;
  return (
    <Screen refreshing={summary.isRefetching} onRefresh={() => void Promise.all([summary.refetch(), expected.refetch()])}>
      <Row style={{ justifyContent: 'space-between' }}>
        <LiveDot />
        <Row gap={0}>
          <NotificationBell />
          <IconButton icon={<Settings2 size={22} color={colors.navy800} />} label={t('nav.account')} onPress={() => router.push('/staff/account')} />
        </Row>
      </Row>
      <ScreenTitle title={t('security.homeTitle')} subtitle={`${session?.user?.fullName ?? ''} · ${t('roles.security')}`} />
      <View style={{ gap: space.sm }}>
        <Button title={t('security.quickScanEntry')} variant="accent" size="lg" icon={<LogIn size={22} color={colors.white} style={flipX()} />} onPress={() => router.push({ pathname: '/(security)/scan', params: { action: 'entry' } })} />
        <Button title={t('security.quickScanExit')} size="lg" icon={<LogOut size={22} color={colors.white} style={flipX()} />} onPress={() => router.push({ pathname: '/(security)/scan', params: { action: 'exit' } })} />
        <Button title={t('security.registerVisitor')} variant="secondary" size="lg" icon={<UserPlus size={22} color={colors.navy900} />} onPress={() => router.push('/staff/register')} />
      </View>
      <StatGrid>
        <StatCard label={t('admin.cards.inside')} value={s?.inside} icon={DoorOpen} tone="blue" loading={summary.isLoading} onPress={() => router.push('/(security)/inside')} />
        <StatCard label={t('admin.cards.overdue')} value={s?.overdue} icon={AlertTriangle} tone="red" loading={summary.isLoading} onPress={() => router.push('/(security)/inside')} />
        <StatCard label={t('admin.cards.expectedToday')} value={s?.expectedToday} icon={CalendarCheck2} tone="green" loading={summary.isLoading} />
      </StatGrid>
      <SectionTitle title={t('security.expectedToday')} />
      {expected.isLoading ? (
        <Loading />
      ) : !expected.data?.items.length ? (
        <EmptyState title={t('security.expectedEmpty')} />
      ) : (
        expected.data.items.map((v) => (
          <VisitCard key={v.id} visit={v} showVisitor onPress={() => router.push(`/staff/visit/${v.id}`)} footer={<AppText variant="small" weight="bold">{`${t('fields.entryWindow')}: ${fmt.time(v.entryWindowStart)} – ${fmt.time(v.entryWindowEnd)}`}</AppText>} />
        ))
      )}
    </Screen>
  );
}
