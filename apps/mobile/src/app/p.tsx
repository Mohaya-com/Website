import * as Linking from 'expo-linking';
import { Redirect, router } from 'expo-router';
import { QrCode, ShieldCheck } from 'lucide-react-native';
import { View } from 'react-native';
import { extractPassToken } from '@vms/shared';
import { AppText, Banner, Button, Card, Screen } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/** Pass link opened outside the scanner (…/p#TOKEN). Only signed-in staff can verify it. */
export default function PassLink() {
  const { t } = useI18n();
  const { session } = useSession();
  const url = Linking.useLinkingURL();
  const token = extractPassToken(url);
  if (session?.kind === 'staff' && token) {
    return <Redirect href={{ pathname: '/staff/scan', params: { qr: token } } as never} />;
  }
  return (
    <Screen edges={['bottom']}>
      <Card style={{ alignItems: 'center', gap: space.md }}>
        <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: colors.navy900, alignItems: 'center', justifyContent: 'center' }}>
          <QrCode size={28} color={colors.white} />
        </View>
        <AppText variant="heading">{t('passLanding.title')}</AppText>
        {token ? <AppText variant="caption" align="center">{t('passLanding.staffOnly')}</AppText> : <Banner tone="warning">{t('passLanding.invalid')}</Banner>}
        <Button title={t('passLanding.signInStaff')} icon={<ShieldCheck size={18} color={colors.white} />} onPress={() => router.replace('/staff-login')} />
      </Card>
    </Screen>
  );
}
