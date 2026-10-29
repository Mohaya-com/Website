import { router } from 'expo-router';
import { Compass } from 'lucide-react-native';
import { Button, EmptyState, Screen } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { colors } from '@/lib/theme';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Screen edges={['top', 'bottom']}>
      <EmptyState icon={<Compass size={28} color={colors.navy600} />} title={t('errors.notFoundPage')} hint={t('errors.notFoundPageHint')} action={<Button title={t('common.goHome')} variant="secondary" onPress={() => router.replace('/')} />} />
    </Screen>
  );
}
