import { I18nManager } from 'react-native';

/** Design tokens shared by all screens (navy, white, teal accents, soft neutrals). */
export const colors = {
  navy950: '#061224',
  navy900: '#0B1F3A',
  navy800: '#12305A',
  navy700: '#1A4073',
  navy600: '#24528F',
  navy200: '#C3D3EA',
  navy100: '#DFE8F5',
  navy50: '#EEF3FA',
  teal800: '#0A5F57',
  teal700: '#0B766B',
  teal600: '#0E8F81',
  teal500: '#14AD9C',
  teal100: '#CDF2EC',
  teal50: '#E9F8F6',
  canvas: '#F3F5F9',
  surface: '#FFFFFF',
  line: '#E1E7EF',
  lineStrong: '#C9D3E0',
  ink: '#0F1B2D',
  muted: '#52637A',
  red700: '#B91C1C',
  red50: '#FEF2F2',
  red100: '#FEE2E2',
  amber800: '#92400E',
  amber50: '#FFFBEB',
  amber100: '#FEF3C7',
  green700: '#047857',
  green50: '#ECFDF5',
  blue800: '#1E40AF',
  blue50: '#EFF6FF',
  slate700: '#334155',
  slate100: '#F1F5F9',
  orange800: '#9A3412',
  orange50: '#FFF7ED',
  violet900: '#4C1D95',
  violet50: '#F5F3FF',
  white: '#FFFFFF',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const fonts = {
  regular: 'Cairo_400Regular',
  medium: 'Cairo_500Medium',
  semibold: 'Cairo_600SemiBold',
  bold: 'Cairo_700Bold',
  extrabold: 'Cairo_800ExtraBold',
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F1B2D',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#0F1B2D',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;

/** Minimum touch target (44pt iOS / 48dp Android guidance). */
export const TOUCH = 48;

/** Flip directional icons (arrows, chevrons) in right-to-left layouts. */
export const flipX = () => ({ transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] });

/** Wrap numbers/IDs so they render left-to-right inside Arabic text. */
export const ltr = (value: string | number | null | undefined) => (value === null || value === undefined ? '' : `⁦${value}⁩`);
