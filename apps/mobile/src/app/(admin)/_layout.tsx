import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import Tabs from 'expo-router/js-tabs';
import { ClipboardCheck, Ellipsis, LayoutDashboard, UserRoundSearch } from 'lucide-react-native';
import type { DashboardSummaryDTO } from '@vms/shared';
import { tabScreenOptions } from '@/components/tabs';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { homeFor, useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';

/** Administrator tabs: لوحة التحكم · طلبات الموافقة · الزوار · المزيد */
export default function AdminTabs() {
  const { t } = useI18n();
  const { session } = useSession();
  const allowed = session?.kind === 'staff' && session.role === 'admin' && !session.user?.mustChangePassword;
  const summary = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: () => api<DashboardSummaryDTO>('/dashboard/summary'), enabled: allowed });
  if (!allowed) return <Redirect href={homeFor(session) as never} />;
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="dashboard" options={{ title: t('nav.dashboard'), tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }} />
      <Tabs.Screen
        name="requests"
        options={{
          title: t('nav.requests'),
          tabBarIcon: ({ color, size }) => <ClipboardCheck color={color} size={size} />,
          tabBarBadge: summary.data?.pending ? summary.data.pending : undefined,
          tabBarBadgeStyle: { backgroundColor: '#F59E0B', color: colors.navy950, fontFamily: fonts.bold, fontSize: 11 },
        }}
      />
      <Tabs.Screen name="visitors" options={{ title: t('nav.visitors'), tabBarIcon: ({ color, size }) => <UserRoundSearch color={color} size={size} /> }} />
      <Tabs.Screen name="more" options={{ title: t('nav.more'), tabBarIcon: ({ color, size }) => <Ellipsis color={color} size={size} /> }} />
    </Tabs>
  );
}
