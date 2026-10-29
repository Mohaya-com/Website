import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ChevronLeft, Search, UserRoundSearch } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Paginated, VisitorSummaryDTO } from '@vms/shared';
import { AppText, Button, EmptyState, ErrorState, Input, Loading, PressableCard, Row, ScreenTitle } from '@/components/ui';
import { DocBadge, useVisitLabels } from '@/components/visit';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { colors, flipX, ltr, space } from '@/lib/theme';

/** الزوار — administrator search by name, ID number, mobile or request reference (masked results). */
export default function Visitors() {
  const { t } = useI18n();
  const labels = useVisitLabels();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['visitors', 'mobile', query],
    queryFn: ({ pageParam }) => api<Paginated<VisitorSummaryDTO>>(`/visitors?page=${pageParam}&pageSize=20${query ? `&q=${encodeURIComponent(query)}` : ''}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <FlatList
        data={items}
        keyExtractor={(v) => v.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <ScreenTitle title={t('admin.visitorsTitle')} subtitle={t('admin.visitorsSubtitle')} />
            <Row>
              <Input value={draft} onChangeText={setDraft} placeholder={t('admin.visitorsSearchPlaceholder')} accessibilityLabel={t('common.search')} returnKeyType="search" onSubmitEditing={() => setQuery(draft.trim())} style={{ flex: 1 }} />
              <Button title={t('common.search')} icon={<Search size={18} color={colors.white} />} onPress={() => setQuery(draft.trim())} />
            </Row>
          </View>
        }
        renderItem={({ item }) => (
          <PressableCard onPress={() => router.push(`/staff/visitor/${item.id}`)} style={{ padding: space.md }}>
            <Row gap={space.md}>
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.navy100, alignItems: 'center', justifyContent: 'center' }}>
                <AppText weight="bold" style={{ color: colors.navy800 }}>
                  {item.fullName.slice(0, 1)}
                </AppText>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText weight="bold">{item.fullName}</AppText>
                <AppText variant="small">{`${t(`documentTypes.${item.documentType}`)} ${ltr(item.documentNumberMasked)} · ${labels.nationality(item.nationality)}`}</AppText>
                <Row style={{ flexWrap: 'wrap' }}>
                  <DocBadge expired={item.documentExpired} />
                  <AppText variant="small">{`${t('fields.visitsCount')}: ${item.visitCount}`}</AppText>
                </Row>
              </View>
              <ChevronLeft size={20} color={colors.muted} style={flipX()} />
            </Row>
          </PressableCard>
        )}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.teal600} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <EmptyState icon={<UserRoundSearch size={28} color={colors.navy600} />} title={t('common.noResults')} hint={t('common.noResultsHint')} />}
        ListFooterComponent={q.isFetchingNextPage ? <View style={{ padding: space.lg }}><ActivityIndicator color={colors.teal600} /></View> : undefined}
      />
    </SafeAreaView>
  );
}
