'use client';

import { Keyboard, LogIn, LogOut, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { extractPassToken, parseGateUrl, type GateAction, type ScanResultDTO, type VisitDTO } from '@vms/shared';
import { api, isApiError } from '@/lib/api';
import { useOnline } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { ScanResultPanel } from './scan-result';
import { Banner } from './ui/feedback';
import { Input, Segmented, Select } from './ui/form';
import { Button, Card, Spinner } from './ui/primitives';
import { useToast } from './ui/toast';
import { useGates } from './visit-filters';
import { VisitSummaryCard } from './visit-views';
import { WebScanner } from './web-scanner';

type Phase = { kind: 'idle' } | { kind: 'verifying' } | { kind: 'result'; result: ScanResultDTO; input: { qr?: string; visitId?: string } } | { kind: 'confirming'; result: ScanResultDTO; input: { qr?: string; visitId?: string } };

const GATE_KEY = 'vms-scan-gate';

/**
 * Gate console: choose gate + action, scan (camera) or look up manually, verify on the server,
 * then explicitly confirm. Nothing is ever authorized offline or from cached data.
 */
export function ScanConsole({ initialAction, initialGateCode, initialQr, initialVisitId }: { initialAction?: GateAction; initialGateCode?: string | null; initialQr?: string | null; initialVisitId?: string | null }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const online = useOnline();
  const gates = useGates();
  const [gateId, setGateId] = useState('');
  const [action, setAction] = useState<GateAction>(initialAction ?? 'entry');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [candidates, setCandidates] = useState<VisitDTO[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const busyRef = useRef(false);
  const handledInitial = useRef(false);

  const gateList = gates.data?.items.filter((g) => (action === 'entry' ? g.supportsEntry : g.supportsExit)) ?? [];

  // Restore the last gate used on this device (not sensitive), or select from a gate QR code.
  useEffect(() => {
    if (!gates.data || gateId) return;
    const fromCode = initialGateCode ? gates.data.items.find((g) => g.code === initialGateCode) : undefined;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(GATE_KEY);
    } catch {
      saved = null;
    }
    const pick = fromCode ?? gates.data.items.find((g) => g.id === saved) ?? gates.data.items[0];
    if (pick) setGateId(pick.id);
  }, [gates.data, gateId, initialGateCode]);

  useEffect(() => {
    if (!gateId) return;
    try {
      localStorage.setItem(GATE_KEY, gateId);
    } catch {
      // ignore
    }
  }, [gateId]);

  const verify = useCallback(
    async (input: { qr?: string; visitId?: string }) => {
      if (busyRef.current) return;
      setError(null);
      if (!online) {
        setError('scan.offlineBlocked');
        return;
      }
      if (!gateId) {
        setError('scan.gateRequired');
        return;
      }
      busyRef.current = true;
      setPhase({ kind: 'verifying' });
      try {
        const result = await api<ScanResultDTO>('/scan/verify', { body: { ...input, gateId, action } });
        setPhase({ kind: 'result', result, input });
        navigator.vibrate?.(result.ok ? 60 : [80, 60, 80]);
      } catch (err) {
        setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
        setPhase({ kind: 'idle' });
      } finally {
        busyRef.current = false;
      }
    },
    [online, gateId, action],
  );

  const onDetect = useCallback(
    (value: string) => {
      if (phase.kind !== 'idle') return;
      const gate = parseGateUrl(value);
      if (gate && !extractPassToken(value)) {
        const g = gates.data?.items.find((x) => x.code === gate.code);
        if (g) {
          setGateId(g.id);
          setAction(gate.action);
          toast(t('scan.gateQrDetected', { gate: locale === 'ar' ? g.nameAr : g.nameEn, action: t(gate.action === 'entry' ? 'scan.entry' : 'scan.exit') }), 'info');
        }
        return;
      }
      void verify({ qr: value });
    },
    [phase.kind, gates.data, toast, t, locale, verify],
  );

  useEffect(() => {
    if (handledInitial.current || !gateId) return;
    if (initialQr) {
      handledInitial.current = true;
      void verify({ qr: initialQr });
    } else if (initialVisitId) {
      handledInitial.current = true;
      void verify({ visitId: initialVisitId });
    }
  }, [gateId, initialQr, initialVisitId, verify]);

  async function confirm(identityConfirmed: boolean) {
    if (phase.kind !== 'result' || busyRef.current) return;
    if (!online) {
      setError('scan.offlineBlocked');
      return;
    }
    busyRef.current = true;
    const { input, result } = phase;
    setPhase({ kind: 'confirming', result, input });
    try {
      const confirmed = await api<ScanResultDTO>('/scan/confirm', { body: { ...input, gateId, action, identityConfirmed } });
      setPhase({ kind: 'result', result: confirmed, input });
      if (confirmed.ok) toast(t(`scan.codes.${confirmed.code}`));
      navigator.vibrate?.(confirmed.ok ? [40, 40, 120] : [80, 60, 80]);
    } catch (err) {
      setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
      setPhase({ kind: 'result', result, input });
    } finally {
      busyRef.current = false;
    }
  }

  async function lookup(e: FormEvent) {
    e.preventDefault();
    if (manual.trim().length < 3) return;
    setLookupBusy(true);
    setError(null);
    try {
      const res = await api<{ items: VisitDTO[] }>('/scan/lookup', { body: { query: manual, action } });
      setCandidates(res.items);
    } catch (err) {
      setError(isApiError(err) ? err.messageKey : 'errors.internal_error');
    } finally {
      setLookupBusy(false);
    }
  }

  const reset = () => {
    setPhase({ kind: 'idle' });
    setCandidates(null);
    setManual('');
    setError(null);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <Card className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-semibold">{t('scan.selectAction')}</p>
              <Segmented
                label={t('scan.selectAction')}
                size="lg"
                value={action}
                onChange={(a) => {
                  setAction(a);
                  reset();
                }}
                options={[
                  { value: 'entry', label: t('scan.entry'), icon: <LogIn className="size-4 rtl:-scale-x-100" aria-hidden /> },
                  { value: 'exit', label: t('scan.exit'), icon: <LogOut className="size-4 rtl:-scale-x-100" aria-hidden /> },
                ]}
              />
            </div>
            <label className="flex flex-col">
              <span className="mb-1.5 text-sm font-semibold">{t('scan.selectGate')}</span>
              <Select value={gateId} onChange={(e) => setGateId(e.target.value)}>
                {gateList.map((g) => (
                  <option key={g.id} value={g.id}>
                    {locale === 'ar' ? g.nameAr : g.nameEn}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <WebScanner onDetect={onDetect} paused={phase.kind !== 'idle' || !gateId} />
        </Card>

        <Card className="p-4">
          <form onSubmit={lookup} className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-bold text-navy-900">
              <Keyboard className="size-4" aria-hidden />
              {t('scan.manualLookup')}
            </p>
            <p className="text-xs text-muted">{t('scan.manualLookupHint')}</p>
            <div className="flex gap-2">
              <Input aria-label={t('scan.manualLookup')} dir="ltr" placeholder={t('scan.manualPlaceholder')} value={manual} onChange={(e) => setManual(e.target.value)} className="ltr-nums" />
              <Button type="submit" loading={lookupBusy} icon={<Search className="size-4" aria-hidden />}>
                {t('common.search')}
              </Button>
            </div>
          </form>
          {candidates && (
            <div className="mt-3 space-y-2">
              {candidates.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-3 text-sm text-muted">{t('scan.manualNoMatch')}</p>
              ) : (
                candidates.map((c) => (
                  <button key={c.id} type="button" className="block w-full text-start" onClick={() => void verify({ visitId: c.id })}>
                    <VisitSummaryCard visit={c} showVisitor />
                  </button>
                ))
              )}
            </div>
          )}
        </Card>
      </div>

      <div>
        {error && (
          <Banner tone="danger" className="mb-4">
            {t.dynamic(error)}
          </Banner>
        )}
        {phase.kind === 'verifying' ? (
          <Card className="grid min-h-60 place-items-center p-8">
            <Spinner label={t('scan.verifying')} />
          </Card>
        ) : phase.kind === 'result' || phase.kind === 'confirming' ? (
          <ScanResultPanel key={`${phase.result.visit?.id ?? 'none'}-${phase.result.code}`} result={phase.result} confirming={phase.kind === 'confirming'} onConfirm={(c) => void confirm(c)} onReset={reset} online={online} />
        ) : (
          <Card className="grid min-h-60 place-items-center p-8 text-center">
            <div>
              <p className="text-lg font-bold text-navy-900">{t('scan.pointCamera')}</p>
              <p className="mt-1 text-sm text-muted">{t('gateLanding.notAuthorization')}</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
