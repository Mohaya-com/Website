import * as Haptics from 'expo-haptics';
import { AlertTriangle, Check, CloudOff, Info, RefreshCw, SearchX } from 'lucide-react-native';
import { useState, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextInputInstance,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { colors, fonts, radius, shadow, space, TOUCH } from '@/lib/theme';

// ───────────────────────────── Text ─────────────────────────────

type Weight = keyof typeof fonts;
type Variant = 'title' | 'heading' | 'subheading' | 'body' | 'label' | 'caption' | 'small';

const VARIANT: Record<Variant, TextStyle & { weight: Weight }> = {
  title: { fontSize: 26, lineHeight: 38, weight: 'extrabold', color: colors.navy900 },
  heading: { fontSize: 19, lineHeight: 30, weight: 'bold', color: colors.navy900 },
  subheading: { fontSize: 16, lineHeight: 26, weight: 'bold', color: colors.ink },
  body: { fontSize: 15, lineHeight: 25, weight: 'regular', color: colors.ink },
  label: { fontSize: 14, lineHeight: 22, weight: 'semibold', color: colors.ink },
  caption: { fontSize: 13, lineHeight: 20, weight: 'regular', color: colors.muted },
  small: { fontSize: 12, lineHeight: 18, weight: 'medium', color: colors.muted },
};

export function AppText({ variant = 'body', weight, color, align, style, ...rest }: TextProps & { variant?: Variant; weight?: Weight; color?: string; align?: 'start' | 'center' | 'end' }) {
  const v = VARIANT[variant];
  const { weight: defaultWeight, ...base } = v;
  return (
    <Text
      maxFontSizeMultiplier={1.6}
      style={[
        base,
        {
          fontFamily: fonts[weight ?? defaultWeight],
          // Native swaps left/right in RTL; react-native-web needs logical values.
          textAlign: (Platform.OS === 'web' ? (align === 'center' ? 'center' : align === 'end' ? 'end' : 'start') : align === 'center' ? 'center' : align === 'end' ? 'right' : 'left') as TextStyle['textAlign'],
          writingDirection: 'auto',
        },
        color ? { color } : null,
        style,
      ]}
      {...rest}
    />
  );
}

// ───────────────────────────── Buttons ─────────────────────────────

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'danger' | 'success' | 'ghost';
const BTN: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.navy900, fg: colors.white },
  accent: { bg: colors.teal600, fg: colors.white },
  success: { bg: colors.green700, fg: colors.white },
  danger: { bg: colors.red700, fg: colors.white },
  secondary: { bg: colors.white, fg: colors.navy900, border: colors.lineStrong },
  ghost: { bg: 'transparent', fg: colors.navy800 },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  size = 'md',
  style,
  accessibilityLabel,
  haptic = true,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  haptic?: boolean;
}) {
  const c = BTN[variant];
  const inactive = disabled || loading;
  const height = size === 'lg' ? 56 : size === 'sm' ? 40 : TOUCH;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      disabled={inactive}
      onPress={() => {
        if (haptic && Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.button,
        { height, backgroundColor: c.bg, borderColor: c.border ?? c.bg, borderWidth: c.border ? 1 : 0, opacity: inactive ? 0.55 : pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
        variant !== 'ghost' && variant !== 'secondary' && shadow.card,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={c.fg} /> : icon}
      <AppText weight="bold" style={{ color: c.fg, fontSize: size === 'lg' ? 17 : size === 'sm' ? 14 : 15.5 }}>
        {title}
      </AppText>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, badge }: { icon: ReactNode; onPress: () => void; label: string; badge?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.navy50 }]}>
      {icon}
      {badge ? (
        <View style={styles.badgeDot}>
          <AppText weight="bold" style={{ color: colors.white, fontSize: 10, lineHeight: 14 }}>
            {badge > 99 ? '99+' : badge}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

// ───────────────────────────── Surfaces ─────────────────────────────

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  return <View style={[styles.card, padded && { padding: space.lg }, style]}>{children}</View>;
}

export function PressableCard({ children, onPress, style, accessibilityLabel }: { children: ReactNode; onPress: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.card, { padding: space.lg }, pressed && { backgroundColor: colors.navy50 }, style]}>
      {children}
    </Pressable>
  );
}

export function Row({ children, style, gap = space.sm, align = 'center', ...rest }: ViewProps & { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; align?: ViewStyle['alignItems'] }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: align, gap }, style]} {...rest}>
      {children}
    </View>
  );
}

export type Tone = 'neutral' | 'navy' | 'teal' | 'green' | 'amber' | 'red' | 'orange' | 'blue' | 'slate' | 'violet';
export const TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: '#F3F4F6', fg: '#374151' },
  navy: { bg: colors.navy50, fg: colors.navy800 },
  teal: { bg: colors.teal50, fg: colors.teal800 },
  green: { bg: colors.green50, fg: colors.green700 },
  amber: { bg: colors.amber50, fg: colors.amber800 },
  red: { bg: colors.red50, fg: colors.red700 },
  orange: { bg: colors.orange50, fg: colors.orange800 },
  blue: { bg: colors.blue50, fg: colors.blue800 },
  slate: { bg: colors.slate100, fg: colors.slate700 },
  violet: { bg: colors.violet50, fg: colors.violet900 },
};

export function Badge({ tone = 'neutral', icon, label }: { tone?: Tone; icon?: ReactNode; label: string }) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]} accessibilityLabel={label}>
      {icon}
      <AppText weight="bold" style={{ color: t.fg, fontSize: 12, lineHeight: 18 }}>
        {label}
      </AppText>
    </View>
  );
}

type BannerTone = 'info' | 'warning' | 'danger' | 'success' | 'dev';
const BANNER: Record<BannerTone, { bg: string; fg: string; border: string }> = {
  info: { bg: colors.navy50, fg: colors.navy900, border: colors.navy100 },
  warning: { bg: colors.amber50, fg: colors.amber800, border: '#FDE68A' },
  danger: { bg: colors.red50, fg: colors.red700, border: '#FECACA' },
  success: { bg: colors.green50, fg: colors.green700, border: '#A7F3D0' },
  dev: { bg: colors.violet50, fg: colors.violet900, border: '#DDD6FE' },
};

export function Banner({ tone = 'info', title, children, icon, action }: { tone?: BannerTone; title?: string; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  const b = BANNER[tone];
  return (
    <View accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : 'summary'} style={[styles.banner, { backgroundColor: b.bg, borderColor: b.border }]}>
      <View style={{ paddingTop: 2 }}>{icon ?? <Info size={18} color={b.fg} />}</View>
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <AppText weight="bold" style={{ color: b.fg }}>
            {title}
          </AppText>
        ) : null}
        {typeof children === 'string' ? (
          <AppText variant="caption" style={{ color: b.fg }}>
            {children}
          </AppText>
        ) : (
          children
        )}
        {action}
      </View>
    </View>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>{icon ?? <SearchX size={28} color={colors.navy600} />}</View>
      <AppText variant="subheading" align="center">
        {title}
      </AppText>
      {hint ? (
        <AppText variant="caption" align="center">
          {hint}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const network = isApiError(error) && error.isNetwork;
  return (
    <View style={styles.empty} accessibilityRole="alert">
      <View style={[styles.emptyIcon, { backgroundColor: network ? colors.amber50 : colors.red50 }]}>
        {network ? <CloudOff size={28} color={colors.amber800} /> : <AlertTriangle size={28} color={colors.red700} />}
      </View>
      <AppText variant="label" align="center">
        {isApiError(error) ? t.dynamic(error.messageKey) : t('errors.internal_error')}
      </AppText>
      {onRetry ? <Button title={t('common.retry')} variant="secondary" size="sm" icon={<RefreshCw size={16} color={colors.navy900} />} onPress={onRetry} /> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <View style={[styles.empty, { paddingVertical: 48 }]} accessibilityLabel={label ?? t('common.loading')}>
      <ActivityIndicator size="large" color={colors.teal600} />
      <AppText variant="caption">{label ?? t('common.loading')}</AppText>
    </View>
  );
}

// ───────────────────────────── Screens ─────────────────────────────

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  edges = ['top'],
  contentStyle,
  footer,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.canvas }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[{ padding: space.lg, gap: space.lg, paddingBottom: 40 }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.teal600} colors={[colors.teal600]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, padding: space.lg, gap: space.lg }, contentStyle]}>{children}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

export function ScreenTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <Row align="flex-start" style={{ justifyContent: 'space-between' }}>
      <View style={{ flex: 1 }}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
      </View>
      {right}
    </Row>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: space.xs }}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {right}
    </Row>
  );
}

export function Detail({ label, value, ltrValue, wide }: { label: string; value: ReactNode; ltrValue?: boolean; wide?: boolean }) {
  return (
    <View style={{ width: wide ? '100%' : '47%', gap: 2 }}>
      <AppText variant="small">{label}</AppText>
      {typeof value === 'string' || typeof value === 'number' ? (
        <AppText weight="bold" style={ltrValue ? { writingDirection: 'ltr' } : undefined}>
          {value === '' ? '—' : String(value)}
        </AppText>
      ) : (
        value
      )}
    </View>
  );
}

export function DetailGrid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md }}>{children}</View>;
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />;
}

// ───────────────────────────── Forms ─────────────────────────────

export function Field({ label, error, hint, required, children }: { label: string; error?: string | null; hint?: string; required?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const message = error ? (t.has(error) ? t.dynamic(error) : error) : null;
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">
        {label}
        {required ? <AppText style={{ color: colors.red700 }}> *</AppText> : null}
      </AppText>
      {children}
      {message ? (
        <Row gap={6} accessibilityLiveRegion="polite">
          <AlertTriangle size={14} color={colors.red700} />
          <AppText variant="caption" style={{ color: colors.red700, flex: 1 }}>
            {message}
          </AppText>
        </Row>
      ) : hint ? (
        <AppText variant="small">{hint}</AppText>
      ) : null}
    </View>
  );
}

export function Input({ invalid, style, ltrInput, ...props }: TextInputProps & { invalid?: boolean; ltrInput?: boolean; ref?: Ref<TextInputInstance> }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor="#94A3B8"
      {...props}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      style={[
        styles.input,
        { borderColor: invalid ? colors.red700 : focused ? colors.teal500 : colors.lineStrong, textAlign: ltrInput ? 'left' : undefined },
        ltrInput && { writingDirection: 'ltr' },
        style,
      ]}
    />
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: ReactNode }[]; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            {o.icon}
            <AppText weight="bold" style={{ color: active ? colors.navy900 : colors.muted }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress, sub }: { label: string; selected: boolean; onPress: () => void; sub?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && { borderColor: colors.teal500, backgroundColor: colors.teal50 }]}
    >
      <AppText weight="bold" style={{ color: selected ? colors.teal800 : colors.ink }}>
        {label}
      </AppText>
      {sub ? <AppText variant="small">{sub}</AppText> : null}
    </Pressable>
  );
}

export function Checkbox({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={[styles.checkbox, checked && { borderColor: colors.teal500, backgroundColor: colors.teal50 }]}
    >
      <View style={[styles.checkboxBox, checked && { backgroundColor: colors.teal600, borderColor: colors.teal600 }]}>{checked ? <Check size={16} color={colors.white} strokeWidth={3} /> : null}</View>
      <View style={{ flex: 1 }}>
        <AppText weight="bold">{label}</AppText>
        {description ? <AppText variant="caption">{description}</AppText> : null}
      </View>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.xl },
  iconButton: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  badgeDot: { position: 'absolute', top: 2, end: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.red700, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: colors.white },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  banner: { flexDirection: 'row', gap: space.sm, borderRadius: radius.md, borderWidth: 1, padding: space.md },
  empty: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.xxxl, paddingHorizontal: space.xl },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: TOUCH + 4, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.white, paddingHorizontal: space.md, fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  segmented: { flexDirection: 'row', backgroundColor: '#EDF1F6', borderRadius: radius.md, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  segmentActive: { backgroundColor: colors.white, ...shadow.card },
  chip: { minHeight: 44, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, padding: space.md, backgroundColor: colors.white, minHeight: TOUCH + 8 },
  checkboxBox: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: '#94A3B8', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
});

export type { PressableProps };
