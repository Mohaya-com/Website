import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { CheckCheck } from 'lucide-react-native';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Paginated, VisitDTO } from '@vms/shared';
import { AppText, EmptyState, ErrorState, Loading, ScreenTitle } from '@/components/ui';
import { VisitCard, useVisitLabels } from '@/components/visit';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors, space } from '@/lib/theme';

/** طلبات الموافقة — pending requests, soonest entry first. */
export default function ApprovalQueue() {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const q = useInfiniteQuery({
    queryKey: ['queue', 'mobile'],
    queryFn: ({ pageParam }) => api<Paginated<VisitDTO>>(`/visits?status=pending&sort=entry_asc&page=${pageParam}&pageSize=15`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    refetchInterval: 15_000,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <FlatList
        data={items}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }}
        ListHeaderComponent={<ScreenTitle title={t('admin.pendingQueue')} subtitle={total !== undefined ? `${total} ${t('status.pending')}` : undefined} />}
        renderItem={({ item }) => (
          <VisitCard
            visit={item}
            showVisitor
            onPress={() => router.push(`/staff/review/${item.id}`)}
            footer={<AppText variant="small">{`${t('fields.submittedBy')}: ${labels.actor(item.submittedBy)} · ${fmt.dateTime(item.submittedAt)}`}</AppText>}
          />
        )}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.teal600} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <EmptyState icon={<CheckCheck size={28} color={colors.navy600} />} title={t('admin.queueEmpty')} hint={t('admin.queueEmptyHint')} />}
        ListFooterComponent={q.isFetchingNextPage ? <View style={{ padding: space.lg }}><ActivityIndicator color={colors.teal600} /></View> : undefined}
      />
    </SafeAreaView>
  );
}
