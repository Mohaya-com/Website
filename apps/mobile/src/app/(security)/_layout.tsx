import { Redirect } from 'expo-router';
import Tabs from 'expo-router/js-tabs';
import { DoorOpen, Home, ScanLine, ScrollText } from 'lucide-react-native';
import { tabScreenOptions } from '@/components/tabs';
import { useI18n } from '@/lib/i18n';
import { homeFor, useSession } from '@/lib/session';

/** Security tabs: الرئيسية · مسح QR · الموجودون داخل المجمع · السجل */
export default function SecurityTabs() {
  const { t } = useI18n();
  const { session } = useSession();
  if (!session || session.kind !== 'staff' || session.role !== 'security' || session.user?.mustChangePassword) return <Redirect href={homeFor(session) as never} />;
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="home" options={{ title: t('nav.home'), tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="scan" options={{ title: t('nav.scan'), tabBarIcon: ({ color, size }) => <ScanLine color={color} size={size} /> }} />
      <Tabs.Screen name="inside" options={{ title: t('nav.insideShort'), tabBarIcon: ({ color, size }) => <DoorOpen color={color} size={size} /> }} />
      <Tabs.Screen name="log" options={{ title: t('nav.log'), tabBarIcon: ({ color, size }) => <ScrollText color={color} size={size} /> }} />
    </Tabs>
  );
}
