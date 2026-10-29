import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

let registeredToken: string | null = null;

export type PushState = 'enabled' | 'denied' | 'not_configured' | 'unsupported';

export function projectId(): string | undefined {
  return (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
});

/**
 * Registers this device for push notifications when the app is configured with an EAS project.
 * In-app notifications work regardless; push previews never include identity details.
 */
export async function registerForPush(requestPermission: boolean): Promise<PushState> {
  if (Platform.OS === 'web') return 'unsupported';
  const pid = projectId();
  if (!pid) return 'not_configured';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Visits', importance: Notifications.AndroidImportance.HIGH }).catch(() => undefined);
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && requestPermission) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'denied';
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    registeredToken = data;
    await api('/push-tokens', { body: { token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
    return 'enabled';
  } catch {
    // e.g. Expo Go on Android (remote push requires a development build) or no network.
    return 'unsupported';
  }
}

export async function unregisterPushToken(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  await api('/push-tokens', { method: 'DELETE', body: { token } });
}
