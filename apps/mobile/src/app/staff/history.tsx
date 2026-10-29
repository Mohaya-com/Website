import { useInfiniteQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { History, Search } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { VISIT_STATUSES, type Paginated, type VisitDTO } from '@vms/shared';
import { Button, Chip, EmptyState, ErrorState, Input, Loading, Row } from '@/components/ui';
import { VisitCard } from '@/components/visit';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { colors, space } from '@/lib/theme';

/** Searchable visit history (administrators): search by name, ID, mobile or reference; filter by status. */
export default function VisitHistory() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState(params.status ?? '');
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const query = new URLSearchParams({ pageSize: '15', sort: 'newest', ...(status ? { status } : {}), ...(q ? { q } : {}) }).toString();
  const list = useInfiniteQuery({
    queryKey: ['visits', 'mobile', query],
    queryFn: ({ pageParam }) => api<Paginated<VisitDTO>>(`/visits?${query}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      style={{ backgroundColor: colors.canvas }}
      data={items}
      keyExtractor={(v) => v.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          <Row>
            <Input value={draft} onChangeText={setDraft} placeholder={t('admin.visitorsSearchPlaceholder')} accessibilityLabel={t('common.search')} returnKeyType="search" onSubmitEditing={() => setQ(draft.trim())} style={{ flex: 1 }} />
            <Button title={t('common.search')} icon={<Search size={18} color={colors.white} />} onPress={() => setQ(draft.trim())} />
          </Row>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            <Chip label={t('common.all')} selected={!status} onPress={() => setStatus('')} />
            {VISIT_STATUSES.map((s) => (
              <Chip key={s} label={t(`status.${s}`)} selected={status === s} onPress={() => setStatus(s)} />
            ))}
          </ScrollView>
        </View>
      }
      renderItem={({ item }) => <VisitCard visit={item} showVisitor onPress={() => router.push(item.status === 'pending' ? `/staff/review/${item.id}` : `/staff/visit/${item.id}`)} />}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={colors.teal600} />}
      onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && void list.fetchNextPage()}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : <EmptyState icon={<History size={28} color={colors.navy600} />} title={t('common.noResults')} hint={t('common.noResultsHint')} />}
      ListFooterComponent={list.isFetchingNextPage ? <View style={{ padding: space.lg }}><ActivityIndicator color={colors.teal600} /></View> : undefined}
    />
  );
}
