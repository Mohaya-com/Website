import { router } from 'expo-router';
import { ChevronLeft, Languages, ShieldCheck, UserRound } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, PressableCard, Row, Screen } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { colors, flipX, radius, space } from '@/lib/theme';

function EntryCard({ icon, title, hint, onPress, accent }: { icon: ReactNode; title: string; hint: string; onPress: () => void; accent?: boolean }) {
  return (
    <PressableCard onPress={onPress} accessibilityLabel={title} style={{ padding: space.xl }}>
      <Row gap={space.lg}>
        <View style={{ width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: accent ? colors.teal600 : colors.navy900 }}>{icon}</View>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">{title}</AppText>
          <AppText variant="caption">{hint}</AppText>
        </View>
        <ChevronLeft size={22} color={colors.muted} style={flipX()} />
      </Row>
    </PressableCard>
  );
}

export default function Welcome() {
  const { t, locale, setLocale } = useI18n();
  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center', gap: space.xl }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.md}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.navy900, alignItems: 'center', justifyContent: 'center' }}>
            <ShieldCheck size={28} color={colors.teal500} />
          </View>
          <View>
            <AppText variant="subheading">{t('app.shortName')}</AppText>
            <AppText variant="small">{t('app.tagline')}</AppText>
          </View>
        </Row>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.language')}
          onPress={() => void setLocale(locale === 'ar' ? 'en' : 'ar')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: radius.md }}
        >
          <Languages size={18} color={colors.navy800} />
          <AppText weight="bold" style={{ color: colors.navy800 }}>
            {locale === 'ar' ? 'English' : 'العربية'}
          </AppText>
        </Pressable>
      </Row>
      <View style={{ gap: 4 }}>
        <AppText variant="title" style={{ fontSize: 32, lineHeight: 46 }}>
          {t('auth.welcomeTitle')}
        </AppText>
        <AppText variant="body" style={{ color: colors.muted }}>
          {t('auth.welcomeSubtitle')}
        </AppText>
      </View>
      <View style={{ gap: space.md }}>
        <EntryCard accent icon={<UserRound size={28} color={colors.white} />} title={t('auth.visitorEntry')} hint={t('auth.visitorEntryHint')} onPress={() => router.push('/visitor-verify')} />
        <EntryCard icon={<ShieldCheck size={28} color={colors.white} />} title={t('auth.staffEntry')} hint={t('auth.staffEntryHint')} onPress={() => router.push('/staff-login')} />
      </View>
    </Screen>
  );
}
