import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Ban, ClipboardCheck, LogOut, Pencil, QrCode } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { hasPermission, type PassDTO, type VisitDTO } from '@vms/shared';
import { AppText, Banner, Button, Card, ErrorState, Loading, Row, Screen } from '@/components/ui';
import { QrCodeView, StatusBadge, VisitDetails, VisitProgress, VisitorIdentity } from '@/components/visit';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, flipX, ltr, space } from '@/lib/theme';

export default function StaffVisit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { session } = useSession();
  const role = session?.role ?? null;
  const [showPass, setShowPass] = useState(false);
  const visit = useQuery({ queryKey: ['visit', id], queryFn: () => api<VisitDTO>(`/visits/${id}`) });
  const pass = useQuery({ queryKey: ['pass', 'staff', id], queryFn: () => api<PassDTO>(`/visits/${id}/pass`), enabled: showPass, retry: false });
  const cancel = useMutation({
    mutationFn: () => api<VisitDTO>(`/visits/${id}/cancel`, { body: {} }),
    onSuccess: (v) => qc.setQueryData(['visit', id], v),
    onError: (err) => Alert.alert(isApiError(err) ? t.dynamic(err.messageKey) : t('errors.internal_error')),
  });

  if (visit.isLoading) return <Loading />;
  if (visit.isError || !visit.data) return <ErrorState error={visit.error} onRetry={() => void visit.refetch()} />;
  const v = visit.data;

  return (
    <Screen edges={['bottom']} refreshing={visit.isRefetching} onRefresh={() => void visit.refetch()}>
      <Card style={{ gap: space.md }}>
        <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <AppText variant="heading">{ltr(v.reference)}</AppText>
          <StatusBadge status={v.status} overdue={v.isOverdue} />
        </Row>
        {v.isOverdue ? <Banner tone="danger">{t('statusDescription.overdue')}</Banner> : null}
        <VisitProgress visit={v} />
      </Card>
      <View style={{ gap: space.sm }}>
        {v.status === 'pending' && hasPermission(role, 'visits.approve') ? (
          <Button title={t('admin.reviewTitle')} variant="accent" icon={<ClipboardCheck size={18} color={colors.white} />} onPress={() => router.push(`/staff/review/${v.id}`)} />
        ) : null}
        {v.status === 'checked_in' ? (
          <Button title={t('scan.confirmExit')} icon={<LogOut size={18} color={colors.white} style={flipX()} />} onPress={() => router.push({ pathname: '/staff/scan', params: { action: 'exit', visit: v.id } })} />
        ) : null}
        {v.hasActivePass && hasPermission(role, 'visits.view_pass') ? <Button title={t('pass.title')} variant="secondary" icon={<QrCode size={18} color={colors.navy900} />} onPress={() => setShowPass((s) => !s)} /> : null}
        {v.canCancel && hasPermission(role, 'visits.modify') ? <Button title={t('request.modifyTitle')} variant="secondary" icon={<Pencil size={18} color={colors.navy900} />} onPress={() => router.push({ pathname: '/staff/register', params: { edit: v.id } })} /> : null}
        {v.canCancel && hasPermission(role, 'visits.cancel_any') ? (
          <Button
            title={t('admin.cancelAsAdmin')}
            variant="danger"
            loading={cancel.isPending}
            icon={<Ban size={18} color={colors.white} />}
            onPress={() =>
              Alert.alert(t('visitor.cancelConfirmTitle'), t('visitor.cancelConfirmBody'), [
                { text: t('common.back'), style: 'cancel' },
                { text: t('admin.cancelAsAdmin'), style: 'destructive', onPress: () => cancel.mutate() },
              ])
            }
          />
        ) : null}
      </View>
      {showPass ? (
        <Card style={{ alignItems: 'center', gap: space.md }}>
          {pass.isLoading ? <Loading /> : pass.data ? <QrCodeView value={pass.data.qrValue} size={220} label={t('pass.title')} /> : <ErrorState error={pass.error} />}
          <AppText variant="small" align="center">
            {t('pass.noPersonalData')}
          </AppText>
        </Card>
      ) : null}
      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">{t('scan.visitDetails')}</AppText>
        <VisitDetails visit={v} />
      </Card>
      {v.visitor ? (
        <Card style={{ gap: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText variant="subheading">{t('request.visitorSection')}</AppText>
            {hasPermission(role, 'visitors.read_full') ? (
              <AppText weight="bold" style={{ color: colors.teal700 }} onPress={() => router.push(`/staff/visitor/${v.visitor!.id}`)}>
                {t('common.seeDetails')}
              </AppText>
            ) : null}
          </Row>
          <VisitorIdentity visitor={v.visitor} />
        </Card>
      ) : null}
    </Screen>
  );
}
