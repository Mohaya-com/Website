import '@fontsource-variable/cairo';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { directionOf, isLocale, DEFAULT_LOCALE, type Locale } from '@vms/shared';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'نظام إدارة الزوار', template: '%s · نظام إدارة الزوار' },
  description: 'Visitor management for a residential compound — إدارة دخول وخروج الزوار',
  applicationName: 'نظام إدارة الزوار',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0b1f3a',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const raw = store.get('vms_locale')?.value;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return (
    <html lang={locale} dir={directionOf(locale)} suppressHydrationWarning>
      <body className="antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
