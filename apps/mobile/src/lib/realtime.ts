import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import EventSource from 'react-native-sse';
import { API_URL, currentToken } from './api';
import { useOnline } from './network';
import { useSession } from './session';

export type LiveStatus = 'live' | 'connecting' | 'polling' | 'offline';

const VISIT_KEYS = ['visits', 'visit', 'review', 'dashboard', 'inside', 'expected', 'queue', 'my-visits', 'my-visit', 'gate-events', 'visitor', 'pass'];

/**
 * Server-Sent Events subscription (identifiers only) that invalidates affected queries.
 * Queries also refetch on an interval, on reconnect and when the app returns to the foreground.
 */
export function useRealtime(): LiveStatus {
  const qc = useQueryClient();
  const { session } = useSession();
  const online = useOnline();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const enabled = Boolean(session && session.kind !== 'registrant');

  useEffect(() => {
    if (!online) {
      setStatus('offline');
      return;
    }
    const token = currentToken();
    if (!enabled || !token) {
      setStatus('polling');
      return;
    }
    setStatus('connecting');
    const es = new EventSource<'ready' | 'change' | 'session'>(`${API_URL}/api/v1/events`, {
      headers: { Authorization: { toString: () => `Bearer ${currentToken() ?? ''}` } },
      pollingInterval: 5000,
      timeoutBeforeConnection: 0,
    });
    let failures = 0;
    es.addEventListener('ready', () => {
      failures = 0;
      setStatus('live');
    });
    es.addEventListener('change', (event) => {
      try {
        const data = JSON.parse(event.data ?? '{}') as { t?: string };
        if (data.t === 'visit') VISIT_KEYS.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }));
        else if (data.t === 'notification') {
          void qc.invalidateQueries({ queryKey: ['notifications'] });
          void qc.invalidateQueries({ queryKey: ['unread'] });
        } else if (data.t === 'config') void qc.invalidateQueries({ queryKey: ['config'] });
      } catch {
        // ignore malformed events
      }
    });
    es.addEventListener('error', () => {
      failures++;
      setStatus(failures > 2 ? 'polling' : 'connecting');
    });
    return () => {
      es.removeAllEventListeners();
      es.close();
    };
  }, [qc, enabled, online, session?.kind]);

  return status;
}
