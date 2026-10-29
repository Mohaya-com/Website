'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_TIMEZONE,
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  formatWeekdayDate,
  formatYmd,
  type PublicConfigDTO,
  type SessionInfoDTO,
} from '@vms/shared';
import { api, isApiError } from './api';
import { useI18n } from './i18n';

export function usePublicConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api<PublicConfigDTO>('/public/config'),
    staleTime: 5 * 60_000,
  });
}

/** Current session (null when signed out). */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api<SessionInfoDTO | null>('/auth/session');
      } catch (err) {
        if (isApiError(err) && (err.status === 401 || err.status === 403)) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export const DRAFT_PREFIX = 'vms-draft:';

/** Signs out and removes cached data and unfinished drafts from this browser. */
export function useLogout() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    try {
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(key);
    } catch {
      // storage unavailable
    }
    window.location.href = '/';
  }, [qc]);
}

export function useFormat() {
  const { locale } = useI18n();
  const { data } = usePublicConfig();
  const tz = data?.timezone ?? DEFAULT_TIMEZONE;
  return useMemo(
    () => ({
      tz,
      dateTime: (v: string | Date | null | undefined) => formatDateTime(v, locale, tz),
      date: (v: string | Date | null | undefined) => formatDate(v, locale, tz),
      time: (v: string | Date | null | undefined) => formatTime(v, locale, tz),
      weekday: (v: string | Date) => formatWeekdayDate(v, locale, tz),
      ymd: (v: string | null | undefined) => formatYmd(v, locale),
      duration: (minutes: number) => formatDuration(minutes, locale),
    }),
    [locale, tz],
  );
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Unfinished-form persistence in sessionStorage (cleared when the tab closes and at sign-out). Never used for identity data. */
export function useDraft<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void, () => void, boolean] {
  const storageKey = `${DRAFT_PREFIX}${key}`;
  const [restored, setRestored] = useState(false);
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        setValue({ ...initial, ...(JSON.parse(raw) as T) });
        setRestored(true);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(resolved));
        } catch {
          // ignore
        }
        return resolved;
      });
    },
    [storageKey],
  );
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    setRestored(false);
  }, [storageKey]);
  return [value, update, clear, restored];
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}
