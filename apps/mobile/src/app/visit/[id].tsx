import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Ban, EyeOff, Info, Pencil, Sun } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import type { PassDTO, VisitDTO } from '@vms/shared';
import { AppText, Banner, Button, Card, ErrorState, Field, Input, Loading, Row, Screen } from '@/components/ui';
import { QrCodeView, StatusBadge, VisitDetails, VisitProgress } from '@/components/visit';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors, ltr, radius, shadow, space } from '@/lib/theme';


/** Request status and (when approved) the QR visit pass. The QR encodes only a random token. */
export default function VisitStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const visit = useQuery({ queryKey: ['my-visit', id], queryFn: () => api<VisitDTO>(`/me/visits/${id}`), refetchInterval: 15_000 });
  const showPass = visit.data && (visit.data.status === 'approved' || visit.data.status === 'checked_in');
  const pass = useQuery({ queryKey: ['pass', id], queryFn: () => api<PassDTO>(`/me/visits/${id}/pass`), enabled: Boolean(showPass), retry: false });
  const cancel = useMutation({
    mutationFn: () => api<VisitDTO>(`/me/visits/${id}/cancel`, { body: { reason: reason.trim() || undefined } }),
    onSuccess: (v) => {
      qc.setQueryData(['my-visit', id], v);
      void qc.invalidateQueries({ queryKey: ['my-visits'] });
      setCancelling(false);
    },
  });

  if (visit.isLoading) return <Loading />;
  if (visit.isError || !visit.data) return <ErrorState error={visit.error} onRetry={() => void visit.refetch()} />;
  const v = visit.data;
  const whatNext = v.status === 'pending' || v.status === 'approved' || v.status === 'checked_in' ? t(`visitor.whatNext.${v.status}`) : null;

  return (
    <Screen edges={['bottom']} refreshing={visit.isRefetching} onRefresh={() => void visit.refetch()}>
      <Card style={{ gap: space.md }}>
        <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <View>
            <AppText variant="small">{t('fields.reference')}</AppText>
            <AppText variant="heading">{ltr(v.reference)}</AppText>
          </View>
          <StatusBadge status={v.status} overdue={v.isOverdue} />
        </Row>
        <AppText>{t(`statusDescription.${v.status}`)}</AppText>
        <VisitProgress visit={v} />
        {whatNext ? <Banner tone="info">{whatNext}</Banner> : null}
        {v.rejectionReason ? <Banner tone="danger" title={t('fields.rejectionReason')}>{v.rejectionReason}</Banner> : null}
        {v.supersededByVisitId ? (
          <Banner tone="info" action={<Button title={t('request.viewReplacement')} variant="ghost" size="sm" onPress={() => router.replace(`/visit/${v.supersededByVisitId}`)} />}>
            {t('request.replacedNotice')}
          </Banner>
        ) : null}
      </Card>

      {showPass ? (
        pass.isLoading ? (
          <Loading />
        ) : pass.data ? (
          <View style={{ backgroundColor: colors.white, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, ...shadow.raised }}>
            <View style={{ backgroundColor: colors.navy900, padding: space.xl, alignItems: 'center', gap: 6 }}>
              <AppText weight="bold" style={{ color: colors.teal500 }}>
                {t('pass.title')}
              </AppText>
              <AppText variant="heading" style={{ color: colors.white }} align="center">
                {pass.data.visitorName}
              </AppText>
              <StatusBadge status={pass.data.status} />
            </View>
            <View style={{ alignItems: 'center', padding: space.xl, gap: space.md }}>
              <View style={{ padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>
                <QrCodeView value={pass.data.qrValue} size={250} label={t('pass.showAtGate')} />
              </View>
              <AppText weight="bold" align="center" style={{ color: colors.navy900 }}>
                {pass.data.status === 'checked_in' ? t('pass.inside') : t('pass.showAtGate')}
              </AppText>
              <View style={{ alignSelf: 'stretch', backgroundColor: colors.navy50, borderRadius: radius.md, padding: space.md, gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View>
                    <AppText variant="small">{t('fields.reference')}</AppText>
                    <AppText weight="extrabold">{ltr(pass.data.reference)}</AppText>
                  </View>
                  <View>
                    <AppText variant="small">{t('fields.villa')}</AppText>
                    <AppText weight="extrabold">{ltr(pass.data.villaNumber)}</AppText>
                  </View>
                </Row>
                <AppText variant="small">{t('pass.validWindow')}</AppText>
                <AppText weight="bold">{`${fmt.date(pass.data.entryWindowStart)} · ${fmt.time(pass.data.entryWindowStart)} – ${fmt.time(pass.data.entryWindowEnd)}`}</AppText>
              </View>
              <View style={{ alignSelf: 'stretch', gap: 6 }}>
                <Row gap={6}>
                  <Sun size={14} color={colors.muted} />
                  <AppText variant="small">{t('pass.brightness')}</AppText>
                </Row>
                <Row gap={6}>
                  <EyeOff size={14} color={colors.muted} />
                  <AppText variant="small">{t('pass.noPersonalData')}</AppText>
                </Row>
                <Row gap={6}>
                  <Info size={14} color={colors.muted} />
                  <AppText variant="small">{t('pass.manualFallback')}</AppText>
                </Row>
              </View>
            </View>
          </View>
        ) : (
          <ErrorState error={pass.error} onRetry={() => void pass.refetch()} />
        )
      ) : null}

      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">{t('scan.visitDetails')}</AppText>
        <VisitDetails visit={v} audience="visitor" />
      </Card>

      {v.canCancel ? (
        cancelling ? (
          <Card style={{ gap: space.md }}>
            <AppText variant="subheading">{t('visitor.cancelConfirmTitle')}</AppText>
            <AppText variant="caption">{t('visitor.cancelConfirmBody')}</AppText>
            {cancel.isError ? <Banner tone="danger">{isApiError(cancel.error) ? t.dynamic(cancel.error.messageKey) : t('errors.internal_error')}</Banner> : null}
            <Field label={t('fields.cancelReason')}>
              <Input value={reason} onChangeText={setReason} maxLength={500} accessibilityLabel={t('fields.cancelReason')} />
            </Field>
            <Button title={t('visitor.cancelVisit')} variant="danger" loading={cancel.isPending} onPress={() => cancel.mutate()} />
            <Button title={t('common.back')} variant="secondary" onPress={() => setCancelling(false)} />
          </Card>
        ) : (
          <View style={{ gap: space.sm }}>
            <Button title={t('request.modifyTitle')} variant="secondary" icon={<Pencil size={18} color={colors.navy900} />} onPress={() => router.push({ pathname: '/(visitor)/request', params: { edit: v.id } })} />
            <Button
              title={t('visitor.cancelVisit')}
              variant="danger"
              icon={<Ban size={18} color={colors.white} />}
              onPress={() =>
                Alert.alert(t('visitor.cancelConfirmTitle'), t('visitor.cancelConfirmBody'), [
                  { text: t('common.back'), style: 'cancel' },
                  { text: t('visitor.cancelVisit'), style: 'destructive', onPress: () => setCancelling(true) },
                ])
              }
            />
          </View>
        )
      ) : null}
    </Screen>
  );
}
