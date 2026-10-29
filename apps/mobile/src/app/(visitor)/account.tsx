import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Bell, ChevronLeft, Languages, LogOut, Shield, Smartphone } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';
import type { VisitorSelfDTO } from '@vms/shared';
import { ExpiryInput, expiryFromStored, expiryToInput, type ExpiryValue } from '@/components/inputs';
import { AppText, Banner, Button, Card, Detail, DetailGrid, PressableCard, Row, Screen, ScreenTitle, SectionTitle, Segmented } from '@/components/ui';
import { DocBadge, useVisitLabels } from '@/components/visit';
import { PushSettings } from '@/features/push-settings';
import { API_URL, api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, flipX, ltr, space } from '@/lib/theme';

export default function VisitorAccount() {
  const { t, locale, setLocale } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const { session, refresh, signOut } = useSession();
  const visitor = session?.visitor;
  const [expiry, setExpiry] = useState<ExpiryValue | null>(null);
  useEffect(() => {
    if (visitor && !expiry) setExpiry(expiryFromStored(visitor.documentExpiryDate, visitor.documentExpiryCalendar, visitor.documentExpiryOriginal));
  }, [visitor, expiry]);
  const save = useMutation({
    mutationFn: () => api<VisitorSelfDTO>('/me/profile', { method: 'PATCH', body: { expectedVersion: visitor!.version, documentExpiry: expiryToInput(expiry!) } }),
    onSuccess: () => {
      void refresh();
      Alert.alert(t('visitor.expiryUpdated'));
    },
  });
  if (!visitor) return null;
  const fieldError = save.error && isApiError(save.error) ? (save.error.fields['documentExpiry.date'] ?? null) : null;

  return (
    <Screen>
      <ScreenTitle title={t('visitor.account')} />
      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">{t('visitor.profileTitle')}</AppText>
        <DetailGrid>
          <Detail label={t('fields.fullName')} value={visitor.fullName} wide />
          <Detail label={t(`documentTypes.${visitor.documentType}`)} value={ltr(visitor.documentNumberMasked)} />
          <Detail label={t('fields.nationality')} value={labels.nationality(visitor.nationality)} />
          <Detail label={t('fields.mobile')} value={ltr(visitor.mobileMasked)} />
          <Detail
            label={t('fields.documentExpiry')}
            value={
              <Row style={{ flexWrap: 'wrap' }}>
                <AppText weight="bold">{fmt.ymd(visitor.documentExpiryDate)}</AppText>
                <DocBadge expired={visitor.documentExpired} />
              </Row>
            }
          />
        </DetailGrid>
        <Banner tone="info" icon={<Smartphone size={18} color={colors.navy900} />}>
          {t('visitor.mobileChangeHint')}
        </Banner>
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">{t('visitor.updateExpiry')}</AppText>
        <AppText variant="caption">{t('visitor.updateExpiryHint')}</AppText>
        {expiry ? <ExpiryInput value={expiry} onChange={setExpiry} error={fieldError} /> : null}
        {save.isError && !fieldError ? <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner> : null}
        <Button title={t('common.save')} loading={save.isPending} onPress={() => save.mutate()} />
      </Card>

      <SectionTitle title={t('account.language')} />
      <Segmented
        label={t('account.language')}
        value={locale}
        onChange={(l) => void setLocale(l)}
        options={[
          { value: 'ar', label: 'العربية', icon: <Languages size={16} color={colors.navy700} /> },
          { value: 'en', label: 'English' },
        ]}
      />
      <AppText variant="small">{t('account.restartNotice')}</AppText>

      <PushSettings />

      <PressableCard onPress={() => router.push('/notifications')}>
        <Row>
          <Bell size={20} color={colors.navy700} />
          <AppText weight="bold" style={{ flex: 1 }}>
            {t('notifications.title')}
          </AppText>
          <ChevronLeft size={20} color={colors.muted} style={flipX()} />
        </Row>
      </PressableCard>
      <PressableCard onPress={() => void Linking.openURL(`${API_URL}/privacy`)}>
        <Row>
          <Shield size={20} color={colors.navy700} />
          <AppText weight="bold" style={{ flex: 1 }}>
            {t('auth.privacyLink')}
          </AppText>
          <ChevronLeft size={20} color={colors.muted} style={flipX()} />
        </Row>
      </PressableCard>
      <Button
        title={t('common.logout')}
        variant="secondary"
        icon={<LogOut size={18} color={colors.navy900} style={flipX()} />}
        onPress={() =>
          Alert.alert(t('common.logout'), t('account.logoutConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.logout'),
              style: 'destructive',
              onPress: () => void signOut().then(() => router.replace('/welcome')),
            },
          ])
        }
      />
    </Screen>
  );
}
