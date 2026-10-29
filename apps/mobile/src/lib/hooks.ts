import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_TIMEZONE,
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  formatWeekdayDate,
  formatYmd,
  type PublicConfigDTO,
  type VillaDTO,
} from '@vms/shared';
import { api } from './api';
import { useI18n } from './i18n';
import { DRAFT_PREFIX } from './session';

export function usePublicConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfigDTO>('/public/config'), staleTime: 5 * 60_000 });
}

export function useVillaOptions(enabled = true) {
  return useQuery({ queryKey: ['villa-options'], queryFn: () => api<{ items: VillaDTO[] }>('/villas/options'), staleTime: 5 * 60_000, enabled });
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
      duration: (m: number) => formatDuration(m, locale),
    }),
    [locale, tz],
  );
}

/**
 * Unfinished visit-request drafts kept in AsyncStorage so a temporary interruption does not lose input.
 * Never used for identity data; removed after submission and at sign-out.
 */
export function useDraft<T extends object>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void, () => void, boolean] {
  const storageKey = `${DRAFT_PREFIX}${key}`;
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    void AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (raw) {
          setValue((prev) => ({ ...prev, ...(JSON.parse(raw) as T) }));
          setRestored(true);
        }
      })
      .catch(() => undefined);
  }, [storageKey]);
  const update = useCallback(
    (next: T | ((p: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        void AsyncStorage.setItem(storageKey, JSON.stringify(resolved)).catch(() => undefined);
        return resolved;
      });
    },
    [storageKey],
  );
  const clear = useCallback(() => {
    void AsyncStorage.removeItem(storageKey).catch(() => undefined);
    setRestored(false);
  }, [storageKey]);
  return [value, update, clear, restored];
}
