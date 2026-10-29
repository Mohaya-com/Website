import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Mobile app configuration. Environment variables (see .env.example):
 *   EXPO_PUBLIC_API_URL  Base URL of the shared backend (the web app), e.g. https://vms.example.com
 *   EAS_PROJECT_ID       Expo project id (required for push notifications and EAS builds)
 *   IOS_BUNDLE_ID / ANDROID_PACKAGE  Store identifiers
 *   APP_LINK_HOST        Domain for universal links / app links (e.g. vms.example.com)
 */
const appLinkHost = process.env.APP_LINK_HOST?.trim();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'إدارة الزوار',
  slug: 'compound-vms',
  scheme: 'vms',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? 'com.example.compoundvms',
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: 'يستخدم التطبيق الكاميرا لمسح رمز تصريح الزيارة عند البوابة فقط، ولا يتم حفظ أي صور. The camera is used only to scan visit pass QR codes.',
      CFBundleAllowMixedLocalizations: true,
    },
    associatedDomains: appLinkHost ? [`applinks:${appLinkHost}`] : [],
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? 'com.example.compoundvms',
    adaptiveIcon: {
      backgroundColor: '#0B1F3A',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    permissions: ['android.permission.CAMERA', 'android.permission.VIBRATE'],
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    predictiveBackGestureEnabled: false,
    intentFilters: appLinkHost
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [
              { scheme: 'https', host: appLinkHost, pathPrefix: '/g/' },
              { scheme: 'https', host: appLinkHost, path: '/p' },
            ],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : [],
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#0B1F3A', image: './assets/images/splash-icon.png', imageWidth: 96 }],
    ['expo-camera', { cameraPermission: 'يستخدم التطبيق الكاميرا لمسح رمز تصريح الزيارة عند البوابة فقط.', recordAudioAndroid: false, barcodeScannerEnabled: true }],
    ['expo-localization', { supportsRTL: true }],
    'expo-secure-store',
    ['expo-notifications', { color: '#0E8F81' }],
    'expo-font',
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
  experiments: {
    typedRoutes: false,
  },
});
