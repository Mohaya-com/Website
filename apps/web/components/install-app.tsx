'use client';

import { Download, Share, SquarePlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { useI18n } from '@/lib/i18n';

const DISMISS_KEY = 'vms_install_dismissed';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Registers the service worker that shows the offline page in the installed app. */
export function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Offers to add the app to the home screen: a one-tap button where the browser supports it (Android
 * Chrome, Edge), and the Share → "Add to Home Screen" steps on iPhone and iPad Safari.
 */
export function InstallApp() {
  const { t } = useI18n();
  const [mode, setMode] = useState<'prompt' | 'ios' | null>(null);
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // storage unavailable
    }
    if (dismissed || isStandalone()) return;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    if (ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) setMode('ios');
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
      setMode('prompt');
    };
    const onInstalled = () => setMode(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!mode) return null;
  const dismiss = () => {
    setMode(null);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // storage unavailable
    }
  };

  return (
    <aside className="relative mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-4" aria-labelledby="install-title">
      <button type="button" onClick={dismiss} className="absolute end-2 top-2 rounded-lg p-1.5 text-muted hover:bg-white/60" aria-label={t('install.dismiss')}>
        <X className="size-4" aria-hidden />
      </button>
      <div className="flex items-start gap-3 pe-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 space-y-1">
          <p id="install-title" className="font-display text-lg font-bold text-navy-900">
            {t('install.title')}
          </p>
          <p className="text-sm text-muted">{t('install.body')}</p>
        </div>
      </div>
      {mode === 'prompt' ? (
        <Button
          className="mt-3"
          block
          icon={<Download className="size-5" aria-hidden />}
          onClick={async () => {
            if (!deferred) return;
            await deferred.prompt();
            const choice = await deferred.userChoice.catch(() => null);
            if (choice?.outcome === 'accepted') setMode(null);
            setDeferred(null);
          }}
        >
          {t('install.button')}
        </Button>
      ) : (
        <ol className="mt-3 space-y-2 text-sm text-navy-900">
          <li className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white text-teal-700">
              <Share className="size-4" aria-hidden />
            </span>
            {t('install.iosStep1')}
          </li>
          <li className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white text-teal-700">
              <SquarePlus className="size-4" aria-hidden />
            </span>
            {t('install.iosStep2')}
          </li>
        </ol>
      )}
    </aside>
  );
}
