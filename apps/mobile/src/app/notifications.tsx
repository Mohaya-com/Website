import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Bell, BellRing, CheckCheck } from 'lucide-react-native';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import type { NotificationDTO, Paginated } from '@vms/shared';
import { AppText, Button, EmptyState, ErrorState, Loading, PressableCard, Row } from '@/components/ui';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/** Persistent in-app notification history (works without push). */
export default function Notifications() {
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const { session } = useSession();
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'mobile'],
    queryFn: ({ pageParam }) => api<Paginated<NotificationDTO>>(`/notifications?page=${pageParam}&pageSize=20`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['unread'] });
  };
  const markAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  const open = (n: NotificationDTO) => {
    if (!n.readAt) void api(`/notifications/${n.id}/read`, { method: 'POST' }).then(refresh);
    if (!n.visitId) return;
    if (session?.kind === 'visitor') router.push(`/visit/${n.visitId}`);
    else router.push(n.type === 'visit_submitted' && session?.role === 'admin' ? `/staff/review/${n.visitId}` : `/staff/visit/${n.visitId}`);
  };
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      style={{ backgroundColor: colors.canvas }}
      data={items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 40 }}
      ListHeaderComponent={items.length ? <Button title={t('notifications.markAllRead')} variant="secondary" size="sm" loading={markAll.isPending} icon={<CheckCheck size={16} color={colors.navy900} />} onPress={() => markAll.mutate()} style={{ alignSelf: 'flex-start', marginBottom: space.sm }} /> : undefined}
      renderItem={({ item: n }) => (
        <PressableCard onPress={() => open(n)} style={{ padding: space.md, backgroundColor: n.readAt ? colors.white : colors.teal50 }}>
          <Row align="flex-start" gap={space.md}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: n.readAt ? colors.slate100 : colors.teal600, alignItems: 'center', justifyContent: 'center' }}>
              {n.readAt ? <Bell size={20} color={colors.muted} /> : <BellRing size={20} color={colors.white} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText weight="bold">{t.dynamic(`notifications.types.${n.type}.title`, n.params)}</AppText>
              <AppText variant="caption">{t.dynamic(`notifications.types.${n.type}.body`, n.params)}</AppText>
              <AppText variant="small">{fmt.dateTime(n.createdAt)}</AppText>
            </View>
          </Row>
        </PressableCard>
      )}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.teal600} />}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
      ListEmptyComponent={q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <EmptyState icon={<Bell size={28} color={colors.navy600} />} title={t('notifications.empty')} hint={t('notifications.emptyHint')} />}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.teal600} /> : undefined}
    />
  );
}
