import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, Check, ShieldAlert, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import type { VisitDTO, VisitReviewDTO } from '@vms/shared';
import { AppText, Badge, Banner, Button, Card, ErrorState, Field, Input, Loading, Row, Screen, SectionTitle, TONES } from '@/components/ui';
import { DocBadge, HistoryList, StatusBadge, VisitDetails, VisitorIdentity } from '@/components/visit';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { colors, ltr, space } from '@/lib/theme';

/** Approval detail: identity, document status, request and complete prior history (chronological) before deciding. */
export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const review = useQuery({ queryKey: ['review', id], queryFn: () => api<VisitReviewDTO>(`/visits/${id}/review`) });

  const done = (message: string) => {
    void qc.invalidateQueries({ queryKey: ['queue'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['review', id] });
    Alert.alert(message);
    router.back();
  };
  const approve = useMutation({ mutationFn: () => api<VisitDTO>(`/visits/${id}/approve`, { body: { expectedVersion: review.data?.visit.version } }), onSuccess: () => done(t('admin.approvedToast')) });
  const reject = useMutation({
    mutationFn: () => api<VisitDTO>(`/visits/${id}/reject`, { body: { reason: reason.trim(), expectedVersion: review.data?.visit.version } }),
    onSuccess: () => done(t('admin.rejectedToast')),
    onError: (err) => isApiError(err) && err.fields.reason && setReasonError(err.fields.reason),
  });

  if (review.isLoading) return <Loading />;
  if (review.isError || !review.data) return <ErrorState error={review.error} onRetry={() => void review.refetch()} />;
  const { visit, visitor, identity, history, stats } = review.data;
  const decisionError = approve.error ?? reject.error;

  return (
    <Screen edges={['bottom']} refreshing={review.isRefetching} onRefresh={() => void review.refetch()}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <AppText variant="heading">{ltr(visit.reference)}</AppText>
        <StatusBadge status={visit.status} />
      </Row>
      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">{t('request.visitorSection')}</AppText>
        <VisitorIdentity visitor={visitor} />
        <View style={{ backgroundColor: colors.slate100, borderRadius: 12, padding: space.md, gap: 6 }}>
          <AppText variant="small" weight="bold">
            {t('admin.identityStatus')}
          </AppText>
          <Row style={{ flexWrap: 'wrap' }}>
            {identity.expired ? <DocBadge expired /> : !identity.validOnVisitDate ? <DocBadge expired label={t('admin.identityInvalidOnVisit')} /> : <DocBadge expired={false} />}
            {!identity.expired && identity.daysUntilExpiry <= 30 ? <Badge tone="amber" icon={<AlertTriangle size={13} color={TONES.amber.fg} />} label={t('admin.identityExpiresInDays', { days: identity.daysUntilExpiry })} /> : null}
          </Row>
        </View>
        {review.data.profileChangedSinceSubmission ? <Banner tone="warning" title={t('admin.profileVersions')}>{t('admin.profileEditHint')}</Banner> : null}
      </Card>
      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">{t('scan.visitDetails')}</AppText>
        <VisitDetails visit={visit} />
      </Card>

      {visit.status !== 'pending' ? (
        <Banner tone="info" title={t('admin.decisionMade')}>
          {t(`statusDescription.${visit.status}`)}
        </Banner>
      ) : review.data.approvalBlockedReason ? (
        <Banner tone="danger" icon={<ShieldAlert size={18} color={colors.red700} />} title={t('admin.approvalBlocked')}>
          {t.dynamic(review.data.approvalBlockedReason)}
        </Banner>
      ) : null}
      {decisionError ? <Banner tone="danger">{isApiError(decisionError) ? t.dynamic(decisionError.messageKey) : t('errors.internal_error')}</Banner> : null}

      {visit.status === 'pending' ? (
        rejecting ? (
          <Card style={{ gap: space.md }}>
            <AppText variant="subheading">{t('admin.rejectTitle')}</AppText>
            <Field label={t('fields.rejectionReason')} required error={reasonError}>
              <Input value={reason} onChangeText={setReason} multiline maxLength={500} placeholder={t('admin.rejectReasonPlaceholder')} accessibilityLabel={t('fields.rejectionReason')} style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }} invalid={Boolean(reasonError)} />
            </Field>
            <Button
              title={t('admin.reject')}
              variant="danger"
              loading={reject.isPending}
              icon={<X size={18} color={colors.white} />}
              onPress={() => {
                if (reason.trim().length < 3) return setReasonError('validation.reasonLength');
                setReasonError(null);
                reject.mutate();
              }}
            />
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setRejecting(false)} />
          </Card>
        ) : (
          <Row>
            <Button
              title={t('admin.approve')}
              variant="success"
              size="lg"
              style={{ flex: 1 }}
              disabled={!review.data.canDecide}
              loading={approve.isPending}
              icon={<Check size={20} color={colors.white} />}
              onPress={() =>
                Alert.alert(t('admin.approveConfirmTitle'), t('admin.approveConfirmBody'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('admin.approve'), onPress: () => approve.mutate() },
                ])
              }
            />
            <Button title={t('admin.reject')} variant="danger" size="lg" style={{ flex: 1 }} icon={<X size={20} color={colors.white} />} onPress={() => setRejecting(true)} />
          </Row>
        )
      ) : null}

      <SectionTitle title={t('admin.previousVisits')} />
      <AppText variant="small">{t('admin.historyStats', { total: stats.total, completed: stats.completed, rejected: stats.rejected, overstays: stats.overstays })}</AppText>
      <HistoryList visits={history} onPress={(h) => router.push(`/staff/visit/${h.id}`)} />
    </Screen>
  );
}
