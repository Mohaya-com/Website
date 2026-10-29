import { router } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { colors, fonts } from '@/lib/theme';
import { AppText, IconButton, Row } from './ui';
import { useLiveStatus } from '@/lib/live';

export const tabScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.teal700,
  tabBarInactiveTintColor: colors.muted,
  tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 11 },
  tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, minHeight: 60 },
  tabBarItemStyle: { paddingTop: 4 },
} as const;

export function NotificationBell() {
  const { t } = useI18n();
  const { data } = useQuery({ queryKey: ['unread'], queryFn: () => api<{ count: number }>('/notifications/unread-count'), refetchInterval: 45_000 });
  return <IconButton icon={<Bell size={22} color={colors.navy800} />} label={t('notifications.title')} badge={data?.count} onPress={() => router.push('/notifications')} />;
}

/** Small "live / reconnecting / offline" indicator. */
export function LiveDot() {
  const { t } = useI18n();
  const status = useLiveStatus();
  const meta =
    status === 'live'
      ? { color: colors.green700, bg: colors.green50, label: t('connectivity.live') }
      : status === 'offline'
        ? { color: colors.red700, bg: colors.red50, label: t('connectivity.offline') }
        : status === 'connecting'
          ? { color: colors.amber800, bg: colors.amber50, label: t('connectivity.reconnecting') }
          : { color: colors.slate700, bg: colors.slate100, label: t('connectivity.polling') };
  return (
    <Row gap={5} style={{ backgroundColor: meta.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 }} accessibilityRole="text" accessibilityLabel={meta.label}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: meta.color }} />
      <AppText variant="small" weight="bold" style={{ color: meta.color }}>
        {meta.label}
      </AppText>
    </Row>
  );
}
