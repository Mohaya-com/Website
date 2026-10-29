import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pencil } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import type { VisitDTO, VisitorFullDTO, VisitorVersionDTO } from '@vms/shared';
import { AppText, Badge, Button, Card, ErrorState, Loading, Row, Screen, SectionTitle } from '@/components/ui';
import { HistoryList, VisitorIdentity, useVisitLabels } from '@/components/visit';
import { VisitorEditForm } from '@/features/visitor-edit';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors, space } from '@/lib/theme';

const FIELD_LABELS: Record<string, string> = { fullName: 'fields.fullName', documentNumber: 'fields.documentNumber', documentExpiry: 'fields.documentExpiry', nationality: 'fields.nationality', mobile: 'fields.mobile', created: 'visitor.registered' };

/** Visitor profile (administrators): identity, change history and the complete visit timeline. */
export default function VisitorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const visitor = useQuery({ queryKey: ['visitor', id], queryFn: () => api<VisitorFullDTO>(`/visitors/${id}`) });
  const visits = useQuery({ queryKey: ['visitor', id, 'visits'], queryFn: () => api<{ items: VisitDTO[] }>(`/visitors/${id}/visits`) });
  const versions = useQuery({ queryKey: ['visitor', id, 'versions'], queryFn: () => api<{ items: VisitorVersionDTO[] }>(`/visitors/${id}/versions`) });
  if (visitor.isLoading) return <Loading />;
  if (visitor.isError || !visitor.data) return <ErrorState error={visitor.error} onRetry={() => void visitor.refetch()} />;
  const v = visitor.data;
  return (
    <Screen edges={['bottom']} refreshing={visitor.isRefetching} onRefresh={() => void Promise.all([visitor.refetch(), visits.refetch(), versions.refetch()])}>
      {editing ? (
        <VisitorEditForm
          visitor={v}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            qc.setQueryData(['visitor', id], updated);
            void qc.invalidateQueries({ queryKey: ['visitor', id, 'versions'] });
            setEditing(false);
          }}
        />
      ) : (
        <Card style={{ gap: space.md }}>
          <VisitorIdentity visitor={v} />
          <AppText variant="small">{`${t('fields.visitsCount')}: ${v.visitCount} · ${t('fields.createdAt')}: ${fmt.date(v.createdAt)}`}</AppText>
          <Button title={t('returning.editProfile')} variant="secondary" icon={<Pencil size={18} color={colors.navy900} />} onPress={() => setEditing(true)} />
        </Card>
      )}
      <SectionTitle title={t('admin.visitHistoryTitle')} />
      {visits.isLoading ? <Loading /> : <HistoryList visits={[...(visits.data?.items ?? [])].reverse()} onPress={(h) => router.push(`/staff/visit/${h.id}`)} />}
      <SectionTitle title={t('admin.profileVersions')} />
      {(versions.data?.items ?? [])
        .slice()
        .reverse()
        .map((ver) => (
          <Card key={ver.version} style={{ gap: 6, padding: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText weight="bold">{`v${ver.version}`}</AppText>
              <AppText variant="small">{fmt.dateTime(ver.createdAt)}</AppText>
            </Row>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {ver.changedFields.map((f) => (
                <Badge key={f} tone="navy" label={t.dynamic(FIELD_LABELS[f] ?? f)} />
              ))}
            </View>
            <AppText variant="small">{`${labels.actor(ver.changedBy)}${ver.changeReason && ver.changeReason !== 'self_service_renewal' ? ` — ${ver.changeReason}` : ''}`}</AppText>
          </Card>
        ))}
    </Screen>
  );
}
