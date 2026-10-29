import { router } from 'expo-router';
import { KeyRound, LogOut } from 'lucide-react-native';
import { Alert } from 'react-native';
import { AppText, Button, Card, Detail, DetailGrid, Screen, SectionTitle, Segmented } from '@/components/ui';
import { PushSettings } from '@/features/push-settings';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, flipX, space } from '@/lib/theme';

/** الحساب واللغة — profile, language (RTL/LTR), push, password, sign-out. */
export default function StaffAccount() {
  const { t, locale, setLocale } = useI18n();
  const fmt = useFormat();
  const { session, signOut } = useSession();
  const user = session?.user;
  return (
    <Screen edges={['bottom']}>
      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">{t('account.profile')}</AppText>
        <DetailGrid>
          <Detail label={t('fields.fullName')} value={user?.fullName ?? ''} wide />
          <Detail label={t('fields.username')} value={user?.username ?? ''} ltrValue />
          <Detail label={t('fields.role')} value={session ? t(`roles.${session.role}`) : ''} />
          <Detail label={t('fields.lastLogin')} value={fmt.dateTime(user?.lastLoginAt)} wide />
        </DetailGrid>
      </Card>
      <SectionTitle title={t('account.language')} />
      <Segmented
        label={t('account.language')}
        value={locale}
        onChange={(l) => void setLocale(l)}
        options={[
          { value: 'ar', label: 'العربية' },
          { value: 'en', label: 'English' },
        ]}
      />
      <AppText variant="small">{t('account.restartNotice')}</AppText>
      <PushSettings />
      <Button title={t('auth.changePasswordTitle')} variant="secondary" icon={<KeyRound size={18} color={colors.navy900} />} onPress={() => router.push('/change-password')} />
      <Button
        title={t('common.logout')}
        variant="secondary"
        icon={<LogOut size={18} color={colors.navy900} style={flipX()} />}
        onPress={() =>
          Alert.alert(t('common.logout'), t('account.logoutConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.logout'), style: 'destructive', onPress: () => void signOut().then(() => router.replace('/welcome')) },
          ])
        }
      />
    </Screen>
  );
}
