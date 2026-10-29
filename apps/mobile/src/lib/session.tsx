import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResultDTO, SessionInfoDTO } from '@vms/shared';
import { api, clearToken, loadToken, onUnauthorized, saveToken } from './api';
import { unregisterPushToken } from './push';

export const DRAFT_PREFIX = 'vms.draft.';

interface SessionValue {
  session: SessionInfoDTO | null;
  loading: boolean;
  /** Stores the token from a successful sign-in / OTP verification. */
  signIn: (result: AuthResultDTO) => Promise<void>;
  setSession: (session: SessionInfoDTO | null) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<SessionInfoDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = await loadToken();
    if (!token) {
      setSession(null);
      return;
    }
    try {
      const s = await api<SessionInfoDTO | null>('/auth/session');
      setSession(s);
      if (!s) await clearToken();
    } catch {
      // Keep the cached session while offline; protected calls still require the server.
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  /** Clears the token, cached server data and unfinished drafts from the device. */
  const signOut = useCallback(async () => {
    await unregisterPushToken().catch(() => undefined);
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await clearToken();
    qc.clear();
    try {
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(DRAFT_PREFIX)));
    } catch {
      // ignore
    }
    setSession(null);
  }, [qc]);

  useEffect(
    () =>
      onUnauthorized(() => {
        void clearToken().then(() => {
          qc.clear();
          setSession(null);
        });
      }),
    [qc],
  );

  const signIn = useCallback(async (result: AuthResultDTO) => {
    if (result.token) await saveToken(result.token);
    setSession(result.session);
  }, []);

  const value = useMemo(() => ({ session, loading, signIn, setSession, refresh, signOut }), [session, loading, signIn, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** Route group for the signed-in principal. */
export function homeFor(session: SessionInfoDTO | null): string {
  if (!session) return '/welcome';
  if (session.kind === 'registrant') return '/visitor-register';
  if (session.kind === 'visitor') return '/(visitor)/home';
  if (session.user?.mustChangePassword) return '/change-password';
  return session.role === 'admin' ? '/(admin)/dashboard' : '/(security)/home';
}
