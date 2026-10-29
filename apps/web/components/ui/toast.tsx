'use client';

import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from './primitives';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => undefined);

let counter = 0;

/** Polite live region for confirmations; errors use the assertive alert role. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++counter;
    setItems((prev) => [...prev.slice(-2), { id, tone, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-semibold text-white shadow-raised animate-slide-up',
              t.tone === 'success' ? 'bg-emerald-700' : t.tone === 'error' ? 'bg-red-700' : 'bg-navy-900',
            )}
          >
            {t.tone === 'success' ? <CheckCircle2 className="size-5 shrink-0" aria-hidden /> : t.tone === 'error' ? <XCircle className="size-5 shrink-0" aria-hidden /> : <Info className="size-5 shrink-0" aria-hidden />}
            <span className="flex-1">{t.message}</span>
            <button type="button" className="rounded-md p-1 hover:bg-white/15" onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))} aria-label="×">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
