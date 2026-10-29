import { useQuery } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { CalendarPlus, DoorOpen, Info, LogOut, QrCode } from 'lucide-react-native';
import { View } from 'react-native';
import type { PublicGateDTO } from '@vms/shared';
import { AppText, Banner, Button, Card, ErrorState, Loading, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, flipX, space } from '@/lib/theme';

/**
 * Deep link from a printed gate QR (https://…/g/CODE?a=entry|exit). The code identifies the gate and action only.
 * Staff go to the scanner preset for this gate; visitors to the request flow or their pass.
 */
export default function GateLink() {
  const { t, locale } = useI18n();
  const { session } = useSession();
  const params = useLocalSearchParams<{ code: string; a?: string }>();
  const action = params.a === 'exit' ? 'exit' : 'entry';
  const gate = useQuery({ queryKey: ['public-gate', params.code], queryFn: () => api<PublicGateDTO>(`/public/gates/${params.code}`), retry: false });

  if (session?.kind === 'staff' && gate.data) {
    return <Redirect href={{ pathname: session.role === 'admin' ? '/staff/scan' : '/(security)/scan', params: { action, gate: gate.data.code } } as never} />;
  }
  if (gate.isLoading) return <Loading />;
  if (gate.isError || !gate.data) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={gate.error} />
        <AppText variant="caption" align="center">
          {t('gateLanding.invalidGate')}
        </AppText>
      </Screen>
    );
  }
  const name = locale === 'ar' ? gate.data.nameAr : gate.data.nameEn;
  const visitor = session?.kind === 'visitor';
  return (
    <Screen edges={['bottom']}>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        <View style={{ backgroundColor: colors.navy900, padding: space.xl, gap: space.sm }}>
          {action === 'entry' ? <DoorOpen size={28} color={colors.teal500} /> : <LogOut size={28} color={colors.teal500} style={flipX()} />}
          <AppText variant="heading" style={{ color: colors.white }}>
            {action === 'entry' ? t('gateLanding.entryTitle', { gate: name }) : t('gateLanding.exitTitle', { gate: name })}
          </AppText>
          <AppText variant="caption" style={{ color: colors.navy100 }}>
            {action === 'entry' ? t('gateLanding.entrySubtitle') : t('gateLanding.exitSubtitle')}
          </AppText>
        </View>
        <View style={{ padding: space.lg, gap: space.md }}>
          {action === 'entry' ? (
            <Button
              title={t('gateLanding.visitorContinue')}
              variant="accent"
              size="lg"
              icon={<CalendarPlus size={20} color={colors.white} />}
              onPress={() => (visitor ? router.replace({ pathname: '/(visitor)/request', params: { gate: gate.data!.code } }) : router.replace({ pathname: '/visitor-verify', params: { next: `/(visitor)/request?gate=${gate.data!.code}` } }))}
            />
          ) : (
            <Button title={t('gateLanding.viewMyPass')} variant="accent" size="lg" icon={<QrCode size={20} color={colors.white} />} onPress={() => router.replace(visitor ? '/(visitor)/home' : '/visitor-verify')} />
          )}
          {!session ? <Button title={t('auth.staffEntry')} variant="secondary" onPress={() => router.push('/staff-login')} /> : null}
          <Banner tone="info" icon={<Info size={18} color={colors.navy900} />}>
            {t('gateLanding.notAuthorization')}
          </Banner>
        </View>
      </Card>
    </Screen>
  );
}
