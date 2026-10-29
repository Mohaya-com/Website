import { useLocalSearchParams } from 'expo-router';
import { Screen, ScreenTitle } from '@/components/ui';
import { ScanScreenContent } from '@/features/scan';
import { useI18n } from '@/lib/i18n';

export default function SecurityScan() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ action?: string; gate?: string; visit?: string }>();
  return (
    <Screen>
      <ScreenTitle title={t('scan.title')} />
      <ScanScreenContent key={`${params.action ?? ''}-${params.visit ?? ''}`} initialAction={params.action === 'exit' ? 'exit' : 'entry'} initialGateCode={params.gate} initialVisitId={params.visit} />
    </Screen>
  );
}
