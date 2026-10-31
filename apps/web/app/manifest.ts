import type { MetadataRoute } from 'next';

/** Makes the site installable as an app (home-screen icon, full screen, no browser bar). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'إدارة الزوار',
    short_name: 'الزوار',
    description: 'إدارة دخول وخروج الزوار في المجمع السكني',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f5ef',
    theme_color: '#22412f',
    categories: ['utilities', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'دخول السكان', short_name: 'ساكن', url: '/login?as=resident', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: 'دخول الموظفين', short_name: 'موظف', url: '/login', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
