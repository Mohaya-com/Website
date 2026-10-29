import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ApiErrorBody } from '@vms/shared';

const TOKEN_KEY = 'vms.session.token';

/** Base URL of the shared backend. Set EXPO_PUBLIC_API_URL (see .env.example). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://localhost:3000').replace(/\/$/, '');

let memoryToken: string | null = null;

// ── Session token: stored only in the platform keychain / keystore (SecureStore) ──
export async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') return memoryToken;
  try {
    memoryToken = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export async function saveToken(token: string): Promise<void> {
  memoryToken = token;
  if (Platform.OS !== 'web') await SecureStore.setItemAsync(TOKEN_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function clearToken(): Promise<void> {
  memoryToken = null;
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
}

export function currentToken(): string | null {
  return memoryToken;
}

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    readonly fields: Record<string, string> = {},
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ClientApiError';
  }
  get isNetwork() {
    return this.code === 'network' || this.code === 'timeout';
  }
}

export function isApiError(err: unknown): err is ClientApiError {
  return err instanceof ClientApiError;
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();
export function onUnauthorized(listener: UnauthorizedListener) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
}

/** JSON client for the shared API. Mobile requests authenticate with a bearer token (no cookies). */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Client': 'mobile' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (memoryToken) headers.Authorization = `Bearer ${memoryToken}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ClientApiError(0, (err as Error).name === 'AbortError' ? 'timeout' : 'network', (err as Error).name === 'AbortError' ? 'errors.timeout' : 'errors.network');
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const body = data as ApiErrorBody | null;
    const code = body?.error?.code ?? 'internal_error';
    if (res.status === 401) unauthorizedListeners.forEach((l) => l());
    throw new ClientApiError(res.status, code, body?.error?.message ?? `errors.${code}`, body?.error?.fields ?? {}, body?.error?.details ?? {});
  }
  return data as T;
}
