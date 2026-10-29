import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { CalendarPlus, QrCode, ShieldAlert } from 'lucide-react-native';
import { View } from 'react-native';
import type { Paginated, VisitDTO } from '@vms/shared';
import { LiveDot, NotificationBell } from '@/components/tabs';
import { AppText, Banner, Button, Card, EmptyState, ErrorState, Loading, Row, Screen, SectionTitle } from '@/components/ui';
import { VisitCard, VisitProgress } from '@/components/visit';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

const OPEN = new Set(['pending', 'approved', 'checked_in']);

export default function VisitorHome() {
  const { t } = useI18n();
  const { session } = useSession();
  const visits = useQuery({ queryKey: ['my-visits', 'home'], queryFn: () => api<Paginated<VisitDTO>>('/me/visits?page=1&pageSize=10') });
  const items = visits.data?.items ?? [];
  const open = items.filter((v) => OPEN.has(v.status)).sort((a, b) => a.requestedEntryAt.localeCompare(b.requestedEntryAt));
  const current = open.find((v) => v.status === 'checked_in') ?? open[0];
  const recent = items.filter((v) => v.id !== current?.id).slice(0, 3);
  const visitor = session?.visitor;

  return (
    <Screen refreshing={visits.isRefetching} onRefresh={() => void visits.refetch()}>
      <Row style={{ justifyContent: 'space-between' }}>
        <LiveDot />
        <NotificationBell />
      </Row>
      <View>
        <AppText variant="title">{t('visitor.homeGreeting', { name: visitor?.fullName.split(' ')[0] ?? '' })}</AppText>
        <AppText variant="caption">{t('visitor.homeSubtitle')}</AppText>
      </View>
      {visitor?.documentExpired ? (
        <Banner tone="danger" icon={<ShieldAlert size={18} color={colors.red700} />}>
          {t('visitor.documentExpiredWarning')}
        </Banner>
      ) : null}
      <Card padded={false} style={{ overflow: 'hidden' }}>
        <View style={{ backgroundColor: colors.navy900, paddingHorizontal: space.lg, paddingVertical: space.md }}>
          <AppText weight="bold" style={{ color: colors.navy100 }}>
            {t('visitor.activeVisit')}
          </AppText>
        </View>
        {visits.isLoading ? (
          <Loading />
        ) : visits.isError ? (
          <ErrorState error={visits.error} onRetry={() => void visits.refetch()} />
        ) : current ? (
          <View style={{ padding: space.lg, gap: space.lg }}>
            <VisitCard visit={current} onPress={() => router.push(`/visit/${current.id}`)} />
            <VisitProgress visit={current} />
            {current.status === 'approved' || current.status === 'checked_in' ? (
              <Button title={t('visitor.viewPass')} variant="accent" size="lg" icon={<QrCode size={20} color={colors.white} />} onPress={() => router.push(`/visit/${current.id}`)} />
            ) : null}
          </View>
        ) : (
          <EmptyState title={t('visitor.noActiveVisit')} hint={t('visitor.noActiveVisitHint')} />
        )}
      </Card>
      <Button title={t('visitor.newRequest')} size="lg" icon={<CalendarPlus size={20} color={colors.white} />} onPress={() => router.push('/(visitor)/request')} />
      {recent.length ? (
        <>
          <SectionTitle title={t('visitor.myVisits')} right={<AppText weight="bold" style={{ color: colors.teal700 }} onPress={() => router.push('/(visitor)/visits')}>{t('common.showAll')}</AppText>} />
          {recent.map((v) => (
            <VisitCard key={v.id} visit={v} onPress={() => router.push(`/visit/${v.id}`)} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

