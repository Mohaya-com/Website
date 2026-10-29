import { Redirect } from 'expo-router';
import Tabs from 'expo-router/js-tabs';
import { CalendarPlus, Home, ListChecks, UserRound } from 'lucide-react-native';
import { useI18n } from '@/lib/i18n';
import { homeFor, useSession } from '@/lib/session';
import { tabScreenOptions } from '@/components/tabs';

/** Visitor tabs: الرئيسية · طلب زيارة · زياراتي · حسابي */
export default function VisitorTabs() {
  const { t } = useI18n();
  const { session } = useSession();
  if (!session || session.kind !== 'visitor') return <Redirect href={homeFor(session) as never} />;
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="home" options={{ title: t('nav.home'), tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="request" options={{ title: t('nav.request'), tabBarIcon: ({ color, size }) => <CalendarPlus color={color} size={size} /> }} />
      <Tabs.Screen name="visits" options={{ title: t('nav.myVisits'), tabBarIcon: ({ color, size }) => <ListChecks color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: t('nav.myAccount'), tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  );
}
