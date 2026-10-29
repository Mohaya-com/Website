import { router, type Href } from 'expo-router';
import { Bell, Building2, ChevronLeft, DoorOpen, History, KeyRound, ScanLine, ScrollText, Settings, ShieldCheck, UserCog, UserPlus, Users, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import type { MessageKey } from '@vms/shared';
import { AppText, PressableCard, Row, Screen, ScreenTitle, SectionTitle } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { colors, flipX, space } from '@/lib/theme';

const OPERATIONS: { href: Href; label: MessageKey; icon: LucideIcon }[] = [
  { href: '/staff/scan', label: 'nav.scan', icon: ScanLine },
  { href: '/staff/inside', label: 'nav.inside', icon: DoorOpen },
  { href: '/staff/register', label: 'nav.register', icon: UserPlus },
  { href: '/staff/history', label: 'nav.visits', icon: History },
  { href: '/staff/log', label: 'nav.log', icon: ScrollText },
  { href: '/notifications', label: 'nav.notifications', icon: Bell },
];

const MANAGEMENT: { href: Href; label: MessageKey; icon: LucideIcon }[] = [
  { href: '/staff/gates', label: 'nav.gates', icon: ShieldCheck },
  { href: '/staff/villas', label: 'nav.villas', icon: Building2 },
  { href: '/staff/users', label: 'nav.users', icon: Users },
  { href: '/staff/settings', label: 'nav.settings', icon: Settings },
  { href: '/staff/audit', label: 'nav.audit', icon: KeyRound },
  { href: '/staff/account', label: 'nav.account', icon: UserCog },
];

function Item({ href, label, icon: Icon }: { href: Href; label: MessageKey; icon: LucideIcon }) {
  const { t } = useI18n();
  return (
    <PressableCard onPress={() => router.push(href)} style={{ padding: space.md }} accessibilityLabel={t(label)}>
      <Row gap={space.md}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={colors.navy700} />
        </View>
        <AppText weight="bold" style={{ flex: 1 }}>
          {t(label)}
        </AppText>
        <ChevronLeft size={20} color={colors.muted} style={flipX()} />
      </Row>
    </PressableCard>
  );
}

export default function More() {
  const { t } = useI18n();
  return (
    <Screen>
      <ScreenTitle title={t('nav.more')} />
      <SectionTitle title={t('admin.sections.operations')} />
      {OPERATIONS.map((i) => (
        <Item key={String(i.href)} {...i} />
      ))}
      <SectionTitle title={t('admin.sections.management')} />
      {MANAGEMENT.map((i) => (
        <Item key={String(i.href)} {...i} />
      ))}
    </Screen>
  );
}
