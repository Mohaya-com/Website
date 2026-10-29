import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { DoorOpen, LogIn, LogOut, ScrollText, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { GateEventDTO, Paginated, VisitDTO } from '@vms/shared';
import { AppText, Badge, Button, Card, EmptyState, ErrorState, Loading, PressableCard, Row, Segmented, TONES } from '@/components/ui';
import { VisitCard, useVisitLabels } from '@/components/visit';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors, flipX, ltr, space } from '@/lib/theme';

export function StatCard({ label, value, icon: Icon, tone, onPress, loading }: { label: string; value: number | undefined; icon: LucideIcon; tone: keyof typeof TONES; onPress?: () => void; loading?: boolean }) {
  const t = TONES[tone];
  const body = (
    <View style={{ gap: 8 }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} color={t.fg} />
      </View>
      {loading ? <ActivityIndicator color={colors.teal600} style={{ alignSelf: 'flex-start' }} /> : <AppText weight="extrabold" style={{ fontSize: 28, lineHeight: 36, color: colors.navy900 }}>{value ?? 0}</AppText>}
      <AppText variant="caption" numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
  const style = { width: '48%' as const };
  return onPress ? (
    <PressableCard onPress={onPress} style={style} accessibilityLabel={`${label}: ${value ?? 0}`}>
      {body}
    </PressableCard>
  ) : (
    <Card style={style}>{body}</Card>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md }}>{children}</View>;
}

/** Visitors currently inside. Overdue visitors remain listed (flagged) until staff record the exit. */
export function InsideList({ limit }: { limit?: number }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const [filter, setFilter] = useState<'all' | 'overdue'>('all');
  const q = useQuery({ queryKey: ['inside'], queryFn: () => api<{ items: VisitDTO[] }>('/visits/inside'), refetchInterval: 20_000 });
  const rows = useMemo(() => {
    const sorted = [...(q.data?.items ?? [])].sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue));
    const filtered = filter === 'overdue' ? sorted.filter((v) => v.isOverdue) : sorted;
    return limit ? filtered.slice(0, limit) : filtered;
  }, [q.data, filter, limit]);
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <View style={{ gap: space.md }}>
      {!limit ? (
        <Segmented
          label={t('common.filter')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `${t('common.all')} (${q.data?.items.length ?? 0})` },
            { value: 'overdue', label: `${t('status.overdue')} (${q.data?.items.filter((v) => v.isOverdue).length ?? 0})` },
          ]}
        />
      ) : null}
      {!rows.length ? (
        <EmptyState icon={<DoorOpen size={28} color={colors.navy600} />} title={t('admin.insideEmpty')} />
      ) : (
        rows.map((v) => (
          <VisitCard
            key={v.id}
            visit={v}
            showVisitor
            onPress={() => router.push(`/staff/visit/${v.id}`)}
            footer={
              <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <AppText variant="small">{t('security.insideSince', { time: fmt.time(v.checkedInAt) })}</AppText>
                <Button title={t('scan.exit')} size="sm" variant="secondary" icon={<LogOut size={16} color={colors.navy900} style={flipX()} />} onPress={() => router.push({ pathname: '/staff/scan', params: { action: 'exit', visit: v.id } })} />
              </Row>
            }
          />
        ))
      )}
    </View>
  );
}

export function useGateEvents() {
  return useInfiniteQuery({
    queryKey: ['gate-events', 'mobile'],
    queryFn: ({ pageParam }) => api<Paginated<GateEventDTO>>(`/gate-events?page=${pageParam}&pageSize=20`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
}

export function GateEventRow({ e }: { e: GateEventDTO }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const entry = e.type === 'entry';
  return (
    <PressableCard onPress={() => router.push(`/staff/visit/${e.visit.id}`)} style={{ padding: space.md }}>
      <Row gap={space.md}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: entry ? colors.green50 : colors.slate100, alignItems: 'center', justifyContent: 'center' }}>
          {entry ? <LogIn size={18} color={colors.green700} style={flipX()} /> : <LogOut size={18} color={colors.slate700} style={flipX()} />}
        </View>
        <View style={{ flex: 1 }}>
          <AppText weight="bold">{e.visit.visitorName}</AppText>
          <AppText variant="small">{`${t(entry ? 'scan.entry' : 'scan.exit')} · ${labels.gate(e.gate)} · ${t('fields.villa')} ${ltr(e.visit.villaNumber)}`}</AppText>
          <AppText variant="small">{`${t('fields.recordedBy')}: ${labels.actor(e.recordedBy)}`}</AppText>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <AppText weight="bold">{fmt.time(e.recordedAt)}</AppText>
          <Badge tone={e.method === 'qr' ? 'teal' : 'amber'} label={e.method === 'qr' ? 'QR' : t('scan.manualLookup')} />
        </View>
      </Row>
    </PressableCard>
  );
}

export function GateLogEmpty() {
  const { t } = useI18n();
  return <EmptyState icon={<ScrollText size={28} color={colors.navy600} />} title={t('security.logEmpty')} />;
}
