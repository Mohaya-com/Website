import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui';
import { ScanScreenContent } from '@/features/scan';

export default function StaffScan() {
  const params = useLocalSearchParams<{ action?: string; gate?: string; visit?: string; qr?: string }>();
  return (
    <Screen edges={['bottom']}>
      <ScanScreenContent initialAction={params.action === 'exit' ? 'exit' : 'entry'} initialGateCode={params.gate} initialVisitId={params.visit} initialQr={params.qr} />
    </Screen>
  );
}
