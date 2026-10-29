import { BellRing } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AppText, Banner, Button, Card, Row } from '@/components/ui';
import { usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { projectId, registerForPush, type PushState } from '@/lib/push';
import { colors, space } from '@/lib/theme';

/** Push status and opt-in. In-app notifications always work; push requires an EAS project and server credentials. */
export function PushSettings() {
  const { t } = useI18n();
  const { data: config } = usePublicConfig();
  const [state, setState] = useState<PushState | 'unknown'>('unknown');
  useEffect(() => {
    if (Platform.OS === 'web') return setState('unsupported');
    if (!projectId()) return setState('not_configured');
    void Notifications.getPermissionsAsync().then((p) => setState(p.status === 'granted' ? 'enabled' : p.canAskAgain ? 'unknown' : 'denied'));
  }, []);
  const serverDisabled = config && !config.push.enabled;
  return (
    <Card style={{ gap: space.md }}>
      <Row>
        <BellRing size={20} color={colors.navy700} />
        <AppText variant="subheading">{t('notifications.pushTitle')}</AppText>
      </Row>
      {state === 'not_configured' || state === 'unsupported' || serverDisabled ? (
        <Banner tone="info">{t('notifications.pushNotConfigured')}</Banner>
      ) : state === 'enabled' ? (
        <Banner tone="success">{t('notifications.pushEnabled')}</Banner>
      ) : state === 'denied' ? (
        <Banner tone="warning" action={<Button title={t('scan.openSettings')} variant="ghost" size="sm" onPress={() => void Linking.openSettings()} />}>
          {t('notifications.pushDenied')}
        </Banner>
      ) : (
        <Button title={t('notifications.pushEnable')} variant="secondary" onPress={() => void registerForPush(true).then(setState)} />
      )}
      <AppText variant="small">{t('notifications.pushPrivacy')}</AppText>
    </Card>
  );
}
