import AsyncStorage from '@react-native-async-storage/async-storage';
import { reloadAppAsync } from 'expo';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DevSettings, I18nManager } from 'react-native';
import { DEFAULT_LOCALE, createTranslator, isLocale, type Locale, type Translator } from '@vms/shared';

const LOCALE_KEY = 'vms.locale';

interface I18nValue {
  t: Translator;
  locale: Locale;
  isRTL: boolean;
  setLocale: (locale: Locale) => Promise<void>;
  ready: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

async function reload() {
  try {
    await reloadAppAsync('Language direction changed');
  } catch {
    if (__DEV__) DevSettings.reload();
  }
}

/**
 * Arabic is the default. Layout direction is applied natively through I18nManager (navigation headers,
 * tabs, gestures and flex layouts all follow it); switching direction requires an app reload.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      let stored: string | null = null;
      try {
        stored = await AsyncStorage.getItem(LOCALE_KEY);
      } catch {
        stored = null;
      }
      const next: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
      setLocaleState(next);
      const wantRTL = next === 'ar';
      I18nManager.allowRTL(true);
      if (I18nManager.isRTL !== wantRTL) {
        I18nManager.forceRTL(wantRTL);
        await reload();
        return;
      }
      setReady(true);
    })();
  }, []);

  const setLocale = useCallback(async (next: Locale) => {
    await AsyncStorage.setItem(LOCALE_KEY, next).catch(() => undefined);
    setLocaleState(next);
    const wantRTL = next === 'ar';
    if (I18nManager.isRTL !== wantRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(wantRTL);
      await reload();
    }
  }, []);

  const value = useMemo<I18nValue>(() => ({ t: createTranslator(locale), locale, isRTL: I18nManager.isRTL, setLocale, ready }), [locale, setLocale, ready]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
