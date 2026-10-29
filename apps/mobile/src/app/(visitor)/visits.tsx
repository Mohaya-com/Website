import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ListChecks } from 'lucide-react-native';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Paginated, VisitDTO } from '@vms/shared';
import { EmptyState, ErrorState, Loading, ScreenTitle } from '@/components/ui';
import { VisitCard } from '@/components/visit';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { colors, space } from '@/lib/theme';

/** زياراتي — paginated with infinite scroll. */
export default function MyVisits() {
  const { t } = useI18n();
  const q = useInfiniteQuery({
    queryKey: ['my-visits', 'list'],
    queryFn: ({ pageParam }) => api<Paginated<VisitDTO>>(`/me/visits?page=${pageParam}&pageSize=15`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <FlatList
        data={items}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }}
        ListHeaderComponent={<ScreenTitle title={t('visitor.myVisits')} />}
        renderItem={({ item }) => <VisitCard visit={item} onPress={() => router.push(`/visit/${item.id}`)} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.teal600} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <EmptyState icon={<ListChecks size={28} color={colors.navy600} />} title={t('visitor.historyEmpty')} hint={t('visitor.historyEmptyHint')} />}
        ListFooterComponent={q.isFetchingNextPage ? <View style={{ padding: space.lg }}><ActivityIndicator color={colors.teal600} /></View> : undefined}
      />
    </SafeAreaView>
  );
}
