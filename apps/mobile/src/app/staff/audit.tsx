import { useInfiniteQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react-native';
import { ActivityIndicator, FlatList, RefreshControl } from 'react-native';
import type { AuditDTO, Paginated } from '@vms/shared';
import { AppText, Badge, Card, EmptyState, ErrorState, Loading, Row } from '@/components/ui';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors, space } from '@/lib/theme';

/** Append-only audit log (administrators only). Metadata never includes raw identity numbers. */
export default function Audit() {
  const { t } = useI18n();
  const fmt = useFormat();
  const q = useInfiniteQuery({
    queryKey: ['audit', 'mobile'],
    queryFn: ({ pageParam }) => api<Paginated<AuditDTO>>(`/audit?page=${pageParam}&pageSize=30`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      style={{ backgroundColor: colors.canvas }}
      data={items}
      keyExtractor={(a) => a.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 40 }}
      ListHeaderComponent={<AppText variant="caption">{t('admin.auditSubtitle')}</AppText>}
      renderItem={({ item }) => {
        const meta = Object.entries(item.metadata)
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' · ');
        return (
          <Card style={{ padding: space.md, gap: 4 }}>
            <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <Badge tone={item.action.includes('failed') || item.action.includes('rejected') ? 'red' : 'navy'} label={t.has(`audit.actions.${item.action}`) ? t.dynamic(`audit.actions.${item.action}`) : item.action} />
              <AppText variant="small">{fmt.dateTime(item.occurredAt)}</AppText>
            </Row>
            <AppText weight="bold">{item.actor.name ?? (item.actor.type === 'system' ? t('common.system') : '—')}</AppText>
            {meta ? (
              <AppText variant="small" numberOfLines={2} style={{ writingDirection: 'ltr' }}>
                {meta}
              </AppText>
            ) : null}
          </Card>
        );
      }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.teal600} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
      ListEmptyComponent={q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <EmptyState icon={<KeyRound size={28} color={colors.navy600} />} title={t('audit.empty')} />}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.teal600} /> : undefined}
    />
  );
}
