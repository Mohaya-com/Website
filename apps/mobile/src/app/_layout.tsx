import { Cairo_400Regular, Cairo_500Medium, Cairo_600SemiBold, Cairo_700Bold, Cairo_800ExtraBold, useFonts } from '@expo-google-fonts/cairo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { CloudOff, FlaskConical } from 'lucide-react-native';
import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui';
import { isApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { setupQueryEnvironment, useAppStateFocus, useOnline } from '@/lib/network';
import { registerForPush } from '@/lib/push';
import { LiveContext } from '@/lib/live';
import { useRealtime } from '@/lib/realtime';
import { SessionProvider, useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
setupQueryEnvironment();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Reliable refresh strategy alongside realtime events.
      refetchInterval: 30_000,
      refetchOnReconnect: true,
      retry: (count, err) => !(isApiError(err) && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

function RealtimeBridge({ children }: { children: ReactNode }) {
  const status = useRealtime();
  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
}

function StatusBanners() {
  const { t } = useI18n();
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const { data } = usePublicConfig();
  if (online && !data?.demoData) return null;
  return (
    <View style={{ paddingTop: insets.top }}>
      {!online ? (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF3C7', paddingVertical: 6, paddingHorizontal: 12 }}>
          <CloudOff size={14} color={colors.amber800} />
          <AppText variant="small" weight="bold" style={{ color: colors.amber800, flexShrink: 1 }}>
            {`${t('connectivity.offline')} — ${t('connectivity.noOfflineAuthorization')}`}
          </AppText>
        </View>
      ) : null}
      {data?.demoData ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EDE9FE', paddingVertical: 4, paddingHorizontal: 12 }}>
          <FlaskConical size={12} color={colors.violet900} />
          <AppText variant="small" style={{ color: colors.violet900, flexShrink: 1 }} numberOfLines={1}>
            {t('app.demoData')}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** Registers for push after sign-in and routes notification taps to the related visit. */
function PushBridge() {
  const { session } = useSession();
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!session || session.kind === 'registrant' || Platform.OS === 'web') return;
    const key = session.user?.id ?? session.visitor?.id ?? '';
    if (asked.current === key) return;
    asked.current = key;
    void registerForPush(true);
  }, [session]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { visitId?: string; type?: string };
      if (!data?.visitId) return;
      if (session?.kind === 'visitor') router.push(`/visit/${data.visitId}`);
      else if (session?.kind === 'staff') router.push(data.type === 'visit_submitted' && session.role === 'admin' ? `/staff/review/${data.visitId}` : `/staff/visit/${data.visitId}`);
    });
    return () => sub.remove();
  }, [session]);
  return null;
}

function AppGate({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { ready, t } = useI18n();
  const { loading } = useSession();
  useAppStateFocus();
  const show = fontsLoaded && ready && !loading;
  useEffect(() => {
    if (show) void SplashScreen.hideAsync().catch(() => undefined);
  }, [show]);
  if (!show) return null;
  return (
    <RealtimeBridge>
      <StatusBar style="dark" />
      <StatusBanners />
      <PushBridge />
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
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="(visitor)" options={{ headerShown: false }} />
        <Stack.Screen name="(security)" options={{ headerShown: false }} />
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
        <Stack.Screen name="staff-login" options={{ title: t('auth.staffLoginTitle') }} />
        <Stack.Screen name="visitor-verify" options={{ title: t('auth.visitorVerifyTitle') }} />
        <Stack.Screen name="visitor-register" options={{ title: t('visitor.registerTitle'), headerBackVisible: false }} />
        <Stack.Screen name="change-password" options={{ title: t('auth.changePasswordTitle') }} />
        <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
        <Stack.Screen name="visit/[id]" options={{ title: t('visitor.statusTitle') }} />
        <Stack.Screen name="g/[code]" options={{ title: t('fields.gate') }} />
        <Stack.Screen name="p" options={{ title: t('passLanding.title') }} />
        <Stack.Screen name="staff" options={{ headerShown: false }} />
      </Stack>
    </RealtimeBridge>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Cairo_400Regular, Cairo_500Medium, Cairo_600SemiBold, Cairo_700Bold, Cairo_800ExtraBold });
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <SessionProvider>
            <AppGate fontsLoaded={fontsLoaded} />
          </SessionProvider>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
