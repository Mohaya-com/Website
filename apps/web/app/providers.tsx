'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import type { Locale } from '@vms/shared';
import { isApiError } from '@/lib/api';
import { I18nProvider } from '@/lib/i18n';
import { RealtimeProvider } from '@/lib/realtime';
import { ToastProvider } from '@/components/ui/toast';

function SessionWatcher() {
  const qc = useQueryClient();
  useEffect(() => {
    const onUnauthenticated = () => void qc.invalidateQueries({ queryKey: ['session'] });
    window.addEventListener('vms:unauthenticated', onUnauthenticated);
    return () => window.removeEventListener('vms:unauthenticated', onUnauthenticated);
  }, [qc]);
  return null;
}

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // Reliable refresh strategy alongside realtime events.
            refetchInterval: 30_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: (count, err) => !(isApiError(err) && err.status >= 400 && err.status < 500) && count < 2,
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale={locale}>
        <ToastProvider>
          <RealtimeProvider>
            <SessionWatcher />
            {children}
          </RealtimeProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
