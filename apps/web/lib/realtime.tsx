'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { useOnline, useSession } from './hooks';
import { useI18n } from './i18n';

export type LiveStatus = 'live' | 'connecting' | 'polling' | 'offline';

const LiveContext = createContext<LiveStatus>('connecting');

/** Visit-related query keys refreshed whenever the server reports a change. */
const VISIT_KEYS = ['visits', 'visit', 'review', 'dashboard', 'inside', 'expected', 'queue', 'my-visits', 'my-visit', 'gate-events', 'visitor', 'pass'];

/**
 * Subscribes to Server-Sent Events and invalidates affected queries. When the stream is unavailable,
 * queries still refresh on an interval and on window focus (see QueryClient defaults).
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const online = useOnline();
  const toast = useToast();
  const { t } = useI18n();
  // Kept in a ref so a new translator or toast function never reopens the stream.
  const notifyEntered = useRef<(name: string) => void>(() => {});
  notifyEntered.current = (name) => toast(name ? t('resident.visitorEntered', { name }) : t('resident.visitorEnteredUnnamed'), 'info');
  const isResident = session?.kind === 'resident';
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const signedIn = Boolean(session && session.kind !== 'registrant');

  useEffect(() => {
    if (!online) {
      setStatus('offline');
      return;
    }
    if (!signedIn || typeof EventSource === 'undefined') {
      setStatus('polling');
      return;
    }
    setStatus('connecting');
    const es = new EventSource('/api/v1/events');
    let failures = 0;
    es.addEventListener('ready', () => {
      failures = 0;
      setStatus('live');
    });
    es.addEventListener('change', (e) => {
      try {
        const event = JSON.parse((e as MessageEvent<string>).data) as { t: string; entered?: string };
        if (event.t === 'visit') {
          for (const key of VISIT_KEYS) void qc.invalidateQueries({ queryKey: [key] });
        } else if (event.t === 'notification') {
          void qc.invalidateQueries({ queryKey: ['notifications'] });
          void qc.invalidateQueries({ queryKey: ['unread'] });
        } else if (event.t === 'gate') {
          void qc.invalidateQueries({ queryKey: ['gate'] });
          void qc.invalidateQueries({ queryKey: ['resident'] });
          // Residents only receive their own villa's events: tell them a visitor has just entered.
          if (isResident && event.entered !== undefined) notifyEntered.current(event.entered);
        } else if (event.t === 'arrival') {
          void qc.invalidateQueries({ queryKey: ['arrivals'] });
        } else if (event.t === 'config') {
          void qc.invalidateQueries({ queryKey: ['config'] });
        }
      } catch {
        // ignore malformed events
      }
    });
    es.addEventListener('session', () => {
      es.close();
      void qc.invalidateQueries({ queryKey: ['session'] });
    });
    es.onerror = () => {
      failures++;
      setStatus(failures > 2 ? 'polling' : 'connecting');
    };
    return () => es.close();
  }, [qc, signedIn, online, isResident]);

  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
}

export function useLiveStatus(): LiveStatus {
  return useContext(LiveContext);
}
