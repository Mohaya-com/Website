import { Redirect, Stack } from 'expo-router';
import { useI18n } from '@/lib/i18n';
import { homeFor, useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';

/** Pushed staff screens (shared by administrators and gate security; each screen enforces its own permission server-side). */
export default function StaffStack() {
  const { t } = useI18n();
  const { session } = useSession();
  if (!session || session.kind !== 'staff' || session.user?.mustChangePassword) return <Redirect href={homeFor(session) as never} />;
  return (
    <Stack
      screenOptions={{
        headerTitleStyle: { fontFamily: fonts.bold, fontSize: 17, color: colors.navy900 },
        headerTintColor: colors.navy900,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.canvas },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="visit/[id]" options={{ title: t('scan.visitDetails') }} />
      <Stack.Screen name="review/[id]" options={{ title: t('admin.reviewTitle') }} />
      <Stack.Screen name="visitor/[id]" options={{ title: t('visitor.profileTitle') }} />
      <Stack.Screen name="register" options={{ title: t('request.onBehalfTitle') }} />
      <Stack.Screen name="scan" options={{ title: t('scan.title') }} />
      <Stack.Screen name="inside" options={{ title: t('admin.insideTitle') }} />
      <Stack.Screen name="history" options={{ title: t('admin.visitHistoryTitle') }} />
      <Stack.Screen name="log" options={{ title: t('security.logTitle') }} />
      <Stack.Screen name="gates" options={{ title: t('admin.gatesTitle') }} />
      <Stack.Screen name="villas" options={{ title: t('admin.villasTitle') }} />
      <Stack.Screen name="users" options={{ title: t('admin.usersTitle') }} />
      <Stack.Screen name="settings" options={{ title: t('admin.settingsTitle') }} />
      <Stack.Screen name="audit" options={{ title: t('admin.auditTitle') }} />
      <Stack.Screen name="account" options={{ title: t('account.title') }} />
    </Stack>
  );
}
