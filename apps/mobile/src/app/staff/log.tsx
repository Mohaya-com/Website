import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { ErrorState, Loading } from '@/components/ui';
import { GateEventRow, GateLogEmpty, useGateEvents } from '@/features/staff';
import { colors, space } from '@/lib/theme';

export default function StaffLog() {
  const q = useGateEvents();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      style={{ backgroundColor: colors.canvas }}
      data={items}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 40 }}
      renderItem={({ item }) => <GateEventRow e={item} />}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.teal600} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <GateLogEmpty />}
      ListFooterComponent={q.isFetchingNextPage ? <View style={{ padding: space.lg }}><ActivityIndicator color={colors.teal600} /></View> : undefined}
    />
  );
}
