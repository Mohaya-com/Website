'use client';

import { CalendarClock, Camera, CheckCircle2, ChevronLeft, ClipboardCopy, Clock, DoorOpen, Loader2, LogIn, LogOut, MessageCircle, Phone, QrCode, RotateCcw, Search, UserPlus, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fieldErrorsFromIssues,
  quickEntrySchema,
  type ArrivalScanResultDTO,
  type DocumentKind,
  type GateDTO,
  type InsideNowDTO,
  type QuickEntryCreatedDTO,
  type QuickEntryDTO,
  type GateQrResultDTO,
  type GateBoardDTO,
  type GateBoardItemDTO,
  type GateVillaDTO,
  type ScanResultDTO,
  normalizeDigits,
} from '@vms/shared';
import { VillaNumberInput } from '@/components/inputs';
import { WebScanner } from '@/components/web-scanner';
import { Dialog } from '@/components/ui/dialog';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Button, Card, cn } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { prepareIdPhoto, type PreparedImage } from '@/lib/image';
import { useI18n } from '@/lib/i18n';

const GATE_KEY = 'vms_gate_id';

function useGateChoice(gates: GateDTO[] | undefined) {
  const [gateId, setGateId] = useState<string>('');
  useEffect(() => {
    if (!gates?.length) return;
    let saved = '';
    try {
      saved = localStorage.getItem(GATE_KEY) ?? '';
    } catch {
      // storage unavailable
    }
    setGateId(gates.some((g) => g.id === saved) ? saved : gates[0]!.id);
  }, [gates]);
  const choose = (id: string) => {
    setGateId(id);
    try {
      localStorage.setItem(GATE_KEY, id);
    } catch {
      // storage unavailable
    }
  };
  return [gateId, choose] as const;
}

// ───────────────────────────── Owner notice ─────────────────────────────

/** WhatsApp button that tells the villa owner their visitor has entered (sent from the guard's phone). */
function NotifyOwner({ villaNumber, name, at }: { villaNumber: string; name: string; at: string }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['gate', 'villa', villaNumber], queryFn: () => api<GateVillaDTO>(`/gate/villa?number=${encodeURIComponent(villaNumber)}`), retry: false });
  const mobile = q.data?.villa?.ownerMobile;
  if (q.isLoading) return null;
  if (!mobile) return <p className="rounded-xl bg-navy-50 p-3 text-sm text-muted">{t('gate.noOwnerMobile')}</p>;
  const text = t('gate.arrivalMessage', { name, villa: villaNumber, time: fmt.time(at) });
  return (
    <a
      href={`https://wa.me/${mobile.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-13 w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-600 px-6 text-base font-semibold text-white shadow-sm hover:bg-emerald-700"
    >
      <MessageCircle className="size-5" aria-hidden />
      {t('gate.notifyOwner')}
    </a>
  );
}

function SuccessMark() {
  return (
    <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-700">
      <CheckCircle2 className="size-9" aria-hidden />
    </span>
  );
}

// ───────────────────────────── New visitor ─────────────────────────────

function EntryPanel({ gateId, onDone, onClose, prefillNumber }: { gateId: string; onDone: () => void; onClose: () => void; prefillNumber?: string | null }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const camera = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<'nameMissing' | 'failed' | null>(null);
  const [villaNumber, setVillaNumber] = useState('');
  const [documentNumber, setDocumentNumber] = useState(prefillNumber ?? '');
  const [documentKind, setDocumentKind] = useState<DocumentKind | null>(null);
  const [fullName, setFullName] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<QuickEntryCreatedDTO | null>(null);

  function reset() {
    setImage(null);
    setReadNote(null);
    setVillaNumber('');
    setDocumentNumber('');
    setDocumentKind(null);
    setFullName('');
    setFields({});
    setCreated(null);
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setReadNote(null);
    setFields({});
    try {
      const prepared = await prepareIdPhoto(file);
      setImage(prepared);
      const res = await api<ArrivalScanResultDTO>('/gate/scan', { body: { idImage: prepared.reading }, timeoutMs: 90_000 }).catch(() => null);
      const f = res?.fields;
      if (f?.documentNumber) setDocumentNumber(f.documentNumber);
      if (f?.documentKind) setDocumentKind(f.documentKind);
      if (f?.fullName) setFullName(f.fullName);
      // Say so when the name was not read, so the guard types it instead of leaving it empty.
      setReadNote(!res ? 'failed' : f?.fullName ? null : 'nameMissing');
      setTimeout(() => document.querySelector<HTMLInputElement>(f?.fullName ? '#gate-villa-wrap input' : '#gate-name')?.focus(), 50);
    } finally {
      setReading(false);
      if (camera.current) camera.current.value = '';
    }
  }

  const save = useMutation({
    mutationFn: (body: unknown) => api<QuickEntryCreatedDTO>('/gate/entries', { body, timeoutMs: 60_000 }),
    onSuccess: (res) => {
      setCreated(res);
      onDone();
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });

  function submit() {
    const body = {
      villaNumber,
      idImage: image ? { type: image.type, data: image.data } : undefined,
      documentKind,
      documentNumber,
      fullName,
      gateId: gateId || null,
    };
    const parsed = quickEntrySchema.safeParse(body);
    if (!parsed.success) {
      setFields(fieldErrorsFromIssues(parsed.error.issues));
      return;
    }
    save.mutate(body);
  }

  if (created) {
    const e = created.entry;
    return (
      <div className="space-y-4 text-center animate-pop">
        <SuccessMark />
        <div>
          <h2 className="text-xl font-extrabold text-navy-900">{t('gate.entered')}</h2>
          <p className="mt-1 text-lg font-bold text-navy-800">
            {t('gate.villaShort', { villa: e.villaNumber })}
            {e.fullName ? ` · ${e.fullName}` : ''}
          </p>
          {e.enteredAt && <p className="mt-1 text-muted">{t('gate.enteredAt', { time: fmt.dateTime(e.enteredAt) })}</p>}
        </div>
        {created.ownerWhatsappUrl ? (
          <a
            href={created.ownerWhatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-13 w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-600 px-6 text-base font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <MessageCircle className="size-5" aria-hidden />
            {t('gate.sendOwner')}
          </a>
        ) : (
          <p className="rounded-xl bg-navy-50 p-3 text-sm text-muted">{t('gate.noOwnerMobile')}</p>
        )}
        <Button
          variant="secondary"
          block
          icon={<ClipboardCopy className="size-5" aria-hidden />}
          onClick={() => void navigator.clipboard?.writeText(created.ownerLink).then(() => toast(t('common.copied'), 'info'))}
        >
          {t('gate.copyOwnerLink')}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button size="lg" variant="accent" icon={<RotateCcw className="size-5" aria-hidden />} onClick={reset}>
            {t('gate.newEntry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
      {prefillNumber && !image && <Banner tone="info">{t('gate.qrIdentity', { number: prefillNumber })}</Banner>}
      {image ? (
        <div className="relative overflow-hidden rounded-2xl border border-line bg-navy-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.previewUrl} alt={t('gate.photoCta')} className="mx-auto max-h-56 w-full object-contain" />
          {reading && (
            <div className="absolute inset-0 grid place-items-center bg-white/70" role="status">
              <span className="flex items-center gap-2 font-semibold text-teal-800">
                <Loader2 className="size-5 animate-spin" aria-hidden />
                {t('gate.reading')}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => camera.current?.click()}
            className="absolute bottom-2 end-2 flex items-center gap-1.5 rounded-full bg-navy-900/85 px-3 py-1.5 text-sm font-semibold text-white"
          >
            <Camera className="size-4" aria-hidden />
            {t('gate.retake')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => camera.current?.click()}
          disabled={reading}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-7 text-center transition-colors',
            fields.idImage ? 'border-red-400 bg-red-50' : 'border-teal-300 bg-teal-50/60 hover:bg-teal-50',
          )}
        >
          {reading ? <Loader2 className="size-12 animate-spin text-teal-700" aria-hidden /> : <Camera className="size-12 text-teal-700" aria-hidden />}
          <span className="text-lg font-extrabold text-navy-900">{t('gate.photoCta')}</span>
          <span className="text-sm text-muted">{fields.idImage ? t('gate.photoRequired') : t('gate.photoHint')}</span>
        </button>
      )}
      {readNote && <Banner tone="warning">{t(readNote === 'failed' ? 'gate.readFailed' : 'gate.nameNotRead')}</Banner>}

      <Field label={t('gate.fullName')} optional error={fields.fullName}>
        {(a) => <Input {...a} id="gate-name" autoComplete="off" className="text-lg font-semibold" value={fullName} onChange={(e) => setFullName(e.target.value)} />}
      </Field>
      <Field label={t('gate.documentNumber')} optional error={fields.documentNumber}>
        {(a) => <Input {...a} dir="ltr" autoComplete="off" className="ltr-nums font-semibold tracking-wider" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />}
      </Field>

      <div id="gate-villa-wrap">
        <VillaNumberInput value={villaNumber} onChange={setVillaNumber} error={fields.villaNumber} large />
      </div>
      <VillaInfo number={villaNumber} />

      {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
      <Button size="lg" variant="accent" block loading={save.isPending} disabled={reading} icon={<LogIn className="size-5 rtl:-scale-x-100" aria-hidden />} onClick={submit}>
        {t('gate.recordEntry')}
      </Button>
    </div>
  );
}

// ───────────────────────────── Villa lookup ─────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Owner name and phone for the typed villa, and the visitors it is expecting (let in only by scanning their QR). */
function VillaInfo({ number }: { number: string }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const villa = useDebounced(normalizeDigits(number).trim().toUpperCase(), 350);
  const q = useQuery({
    queryKey: ['gate', 'villa', villa],
    queryFn: () => api<GateVillaDTO>(`/gate/villa?number=${encodeURIComponent(villa)}`),
    enabled: villa.length > 0 && /^[A-Z0-9؀-ۿ\-/ ]{1,20}$/.test(villa),
    retry: false,
  });
  if (!villa || !q.data) return null;
  const v = q.data.villa;
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-navy-50/60 p-4">
      {!v ? (
        <p className="text-sm text-muted">{t('gate.villaUnknown')}</p>
      ) : (
        <>
          {!v.isActive && <Banner tone="warning">{t('gate.villaInactive')}</Banner>}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted">{t('gate.villaOwner')}</p>
              <p className="truncate text-lg font-bold text-navy-900">{v.ownerName ?? '—'}</p>
            </div>
            {v.ownerMobile && (
              <a href={`tel:${v.ownerMobile}`} className="flex shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 font-semibold text-teal-700 shadow-sm" dir="ltr">
                <Phone className="size-4" aria-hidden />
                <span className="ltr-nums">{v.ownerMobile.startsWith('+966') ? `0${v.ownerMobile.slice(4)}` : v.ownerMobile}</span>
              </a>
            )}
          </div>
          {q.data.expected.length > 0 && (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-sm font-bold text-navy-900">{t('gate.expectedTitle')}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <QrCode className="size-3.5" aria-hidden />
                {t('gate.expectedScanHint')}
              </p>
              {q.data.expected.map((e) => (
                <div key={e.id} className="rounded-xl bg-white p-3 shadow-sm">
                  <p className="truncate font-semibold text-navy-900">{e.fullName ?? t('gate.unnamed')}</p>
                  {e.expectedAt && (
                    <p className="flex items-center gap-1 text-xs text-muted">
                      <CalendarClock className="size-3.5" aria-hidden />
                      {fmt.dateTime(e.expectedAt)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── Registered visitor (QR) ─────────────────────────────

interface CheckedIn {
  name: string;
  villaNumber: string;
  at: string;
  alreadyInside: boolean;
}

/**
 * Checks in a visitor who was registered beforehand: a resident's invitation or an approved visit pass
 * is checked in as soon as it is scanned. A code carrying an identity number opens a new entry.
 */
function CheckInPanel({ gateId, onIdentity, onDone, onClose }: { gateId: string; onIdentity: (documentNumber: string) => void; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [manual, setManual] = useState('');
  const [done, setDone] = useState<CheckedIn | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: async (qr: string): Promise<CheckedIn | null> => {
      const res = await api<GateQrResultDTO>('/gate/qr', { body: { qr, gateId: gateId || null } });
      if (res.kind === 'invite') {
        return { name: res.entry.fullName ?? t('gate.unnamed'), villaNumber: res.entry.villaNumber, at: res.entry.enteredAt ?? new Date().toISOString(), alreadyInside: res.alreadyInside };
      }
      if (res.kind === 'identity') {
        onIdentity(res.documentNumber);
        return null;
      }
      if (res.kind === 'unknown') throw new Error('gate.qrUnknown');
      // A visit pass: verify, then record the entry straight away.
      if (!gateId) throw new Error('scan.gateRequired');
      const verified = await api<ScanResultDTO>('/scan/verify', { body: { qr, gateId, action: 'entry' } });
      if (!verified.ok) throw new Error(`scan.codes.${verified.code}`);
      const confirmed = await api<ScanResultDTO>('/scan/confirm', { body: { qr, gateId, action: 'entry', identityConfirmed: true } });
      if (!confirmed.ok) throw new Error(`scan.codes.${confirmed.code}`);
      return { name: confirmed.visit?.visitor?.fullName ?? t('gate.unnamed'), villaNumber: confirmed.visit?.villa.number ?? '', at: confirmed.recordedAt ?? new Date().toISOString(), alreadyInside: false };
    },
    onSuccess: (res) => {
      if (!res) return;
      setDone(res);
      navigator.vibrate?.([40, 40, 120]);
      onDone();
    },
    onError: (err) => {
      setFailure(isApiError(err) ? err.messageKey : err instanceof Error && /^(gate|scan)\./.test(err.message) ? err.message : 'errors.internal_error');
      navigator.vibrate?.([80, 60, 80]);
    },
  });
  const onDetect = useCallback((value: string) => {
    if (!check.isPending) check.mutate(value);
  }, [check]);
  const reset = () => {
    setDone(null);
    setFailure(null);
    check.reset();
    setManual('');
  };

  if (done || failure) {
    return (
      <div className="space-y-4 text-center animate-pop">
        {done ? (
          <>
            <SuccessMark />
            <p className="text-xl font-extrabold text-navy-900">{done.alreadyInside ? t('gate.alreadyInside', { name: done.name }) : t('gate.checkedIn', { name: done.name })}</p>
            {done.villaNumber && <p className="text-muted">{t('gate.villaShort', { villa: done.villaNumber })}</p>}
            {done.villaNumber && !done.alreadyInside && <NotifyOwner villaNumber={done.villaNumber} name={done.name} at={done.at} />}
          </>
        ) : (
          <Banner tone="danger">{t.dynamic(failure!)}</Banner>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button size="lg" variant="accent" icon={<RotateCcw className="size-5" aria-hidden />} onClick={reset}>
            {t('gate.scanAgain')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('gate.qrHint')}</p>
      <div className="relative overflow-hidden rounded-2xl">
        <WebScanner onDetect={onDetect} paused={check.isPending} />
        {check.isPending && (
          <div className="absolute inset-0 grid place-items-center bg-white/70" role="status">
            <Loader2 className="size-10 animate-spin text-teal-700" aria-label={t('common.loading')} />
          </div>
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) check.mutate(manual.trim());
        }}
      >
        <Input aria-label={t('gate.qrManual')} placeholder={t('gate.qrManual')} dir="ltr" value={manual} onChange={(e) => setManual(e.target.value)} />
        <Button type="submit" variant="secondary" loading={check.isPending}>
          {t('gate.qrCheck')}
        </Button>
      </form>
    </div>
  );
}

// ───────────────────────────── Inside the compound ─────────────────────────────

interface InsideItem {
  key: string;
  kind: 'entry' | 'visit';
  id: string;
  name: string;
  villaNumber: string;
  enteredAt: string;
  entry?: QuickEntryDTO;
}

/** Everyone inside, full width. The icon beside each name records the exit (tap, then tap again to confirm). */
function InsideList({ inside, gateId }: { inside: InsideNowDTO | undefined; gateId: string }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  const all = useMemo<InsideItem[]>(() => {
    if (!inside) return [];
    return [
      ...inside.entries.map((e) => ({
        key: `e-${e.id}`,
        kind: 'entry' as const,
        id: e.id,
        name: e.fullName ?? (e.documentNumber ? `${t('gate.unnamed')} · ${e.documentNumber}` : t('gate.unnamed')),
        villaNumber: e.villaNumber,
        enteredAt: e.enteredAt ?? '',
        entry: e,
      })),
      ...inside.visits.map((v) => ({ key: `v-${v.id}`, kind: 'visit' as const, id: v.id, name: v.fullName, villaNumber: v.villaNumber, enteredAt: v.checkedInAt })),
    ].sort((a, b) => (a.enteredAt < b.enteredAt ? 1 : -1));
  }, [inside, t]);
  const needle = q.trim().toLowerCase();
  const items = needle ? all.filter((i) => i.name.toLowerCase().includes(needle) || i.villaNumber.toLowerCase().includes(needle)) : all;

  const exit = useMutation({
    mutationFn: async (item: InsideItem) => {
      if (item.kind === 'entry') return api(`/gate/entries/${item.id}/exit`, { method: 'POST', body: {} });
      return api('/scan/confirm', { body: { visitId: item.id, gateId, action: 'exit' } });
    },
    onSuccess: (_res, item) => {
      toast(t('gate.exitDone', { name: item.name }));
      setArmed(null);
      void qc.invalidateQueries({ queryKey: ['gate'] });
      void qc.invalidateQueries({ queryKey: ['inside'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast(isApiError(err) ? t.dynamic(err.messageKey) : t('errors.internal_error'), 'error'),
  });

  return (
    <section aria-labelledby="inside-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="inside-title" className="flex items-center gap-2 text-xl font-extrabold text-navy-900">
          <DoorOpen className="size-6 text-teal-700" aria-hidden />
          {t('gate.exitTab')}
          <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-base text-teal-800 ltr-nums">{all.length}</span>
        </h2>
        {all.length > 0 && (
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label={t('gate.search')} placeholder={t('gate.search')} className="h-11 ps-10" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </div>
      {!inside ? (
        <LoadingRows rows={4} />
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<DoorOpen className="size-7" aria-hidden />} title={needle ? t('common.noResults') : t('gate.emptyInside')} />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const isArmed = armed === item.key;
            const busy = exit.isPending && exit.variables?.key === item.key;
            return (
              <li key={item.key} className={cn('flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm transition-colors', isArmed ? 'border-red-300 bg-red-50/50' : 'border-line')}>
                {item.entry?.hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/v1/gate/entries/${item.id}/image`} alt="" loading="lazy" className="size-14 shrink-0 rounded-xl border border-line object-cover" />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700">
                    <UserRound className="size-6" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-bold text-navy-900">{item.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <span className="font-semibold text-navy-800">{t('gate.villaShort', { villa: item.villaNumber })}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" aria-hidden />
                      <span className="ltr-nums">{fmt.time(item.enteredAt)}</span>
                    </span>
                    {item.kind === 'visit' && <Badge tone="blue">{t('gate.withPass')}</Badge>}
                    {item.entry?.ownerResponse === 'confirmed' && <Badge tone="green">{t('gate.ownerConfirmed')}</Badge>}
                    {item.entry?.ownerResponse === 'declined' && <Badge tone="red">{t('gate.ownerDeclined')}</Badge>}
                  </span>
                </span>
                {isArmed ? (
                  <Button size="sm" variant="danger" loading={busy} onClick={() => exit.mutate(item)} icon={<LogOut className="size-4 rtl:-scale-x-100" aria-hidden />}>
                    {t('gate.confirmExit')}
                  </Button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setArmed(item.key)}
                    aria-label={t('gate.quickExit', { name: item.name })}
                    title={t('gate.exitButton')}
                    className="grid size-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-navy-800 transition-colors hover:bg-red-50 hover:text-red-700"
                  >
                    <LogOut className="size-6 rtl:-scale-x-100" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────────── Upcoming and completed today ─────────────────────────────

function BoardList({ title, icon, items, empty, timeLabel }: { title: string; icon: ReactNode; items: GateBoardItemDTO[] | undefined; empty: string; timeLabel: (item: GateBoardItemDTO) => string }) {
  const { t } = useI18n();
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-extrabold text-navy-900">
        {icon}
        {title}
        {items && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm text-navy-800 ltr-nums">{items.length}</span>}
      </h2>
      {!items ? (
        <LoadingRows rows={2} />
      ) : !items.length ? (
        <Card>
          <EmptyState title={empty} />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <Link
                href={item.kind === 'entry' ? `/staff/entries/${item.id}` : `/staff/visits/${item.id}`}
                className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3 shadow-sm transition-colors hover:border-teal-400 hover:bg-teal-50/40"
              >
                {item.hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/v1/gate/entries/${item.id}/image`} alt="" loading="lazy" className="size-12 shrink-0 rounded-xl border border-line object-cover" />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700">
                    <UserRound className="size-5" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-navy-900">{item.fullName ?? t('gate.unnamed')}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted">
                    <span className="font-semibold text-navy-800">{t('gate.villaShort', { villa: item.villaNumber })}</span>
                    <span>{timeLabel(item)}</span>
                    {item.kind === 'visit' && <Badge tone="blue">{t('gate.withPass')}</Badge>}
                  </span>
                </span>
                <ChevronLeft className="size-5 shrink-0 text-muted ltr:rotate-180" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────────── Dashboard ─────────────────────────────

function ActionTile({ icon, title, hint, onClick, tone }: { icon: ReactNode; title: string; hint: string; onClick: () => void; tone: 'primary' | 'paper' }) {
  const primary = tone === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl p-4 text-center shadow-sm transition-transform active:scale-[0.98]',
        primary ? 'bg-navy-900 text-white hover:bg-navy-800' : 'border border-line bg-white text-navy-900 hover:bg-navy-50',
      )}
    >
      <span className={cn('grid size-12 place-items-center rounded-full', primary ? 'bg-white/15' : 'bg-navy-50 text-teal-700')}>{icon}</span>
      <span className="font-display text-lg font-bold leading-tight">{title}</span>
      <span className={cn('text-xs', primary ? 'text-white/80' : 'text-muted')}>{hint}</span>
    </button>
  );
}

/**
 * The gate dashboard: two actions (register a new visitor, check in a registered one by QR) and the
 * full list of everyone inside, each with a one-tap exit.
 */
export function GateConsole({ title, subtitle }: { title?: string; subtitle?: string }) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<'new' | 'checkin' | null>(null);
  const [prefill, setPrefill] = useState<{ number: string; key: number } | null>(null);
  const gates = useQuery({ queryKey: ['gates', 'active'], queryFn: () => api<{ items: GateDTO[] }>('/gates') });
  const activeGates = gates.data?.items.filter((g) => g.isActive);
  const [gateId, setGateId] = useGateChoice(activeGates);
  const inside = useQuery({ queryKey: ['gate', 'inside'], queryFn: () => api<InsideNowDTO>('/gate/inside'), refetchInterval: 30_000 });
  const board = useQuery({ queryKey: ['gate', 'board'], queryFn: () => api<GateBoardDTO>('/gate/board'), refetchInterval: 60_000 });
  const fmt = useFormat();
  const close = () => {
    setMode(null);
    setPrefill(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900">{title ?? t('gate.title')}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {activeGates && activeGates.length > 1 && (
          <Select aria-label={t('gate.gateLabel')} className="w-auto min-w-40" value={gateId} onChange={(e) => setGateId(e.target.value)}>
            {activeGates.map((g) => (
              <option key={g.id} value={g.id}>
                {locale === 'ar' ? g.nameAr : g.nameEn}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ActionTile tone="primary" icon={<UserPlus className="size-7" aria-hidden />} title={t('gate.newVisitor')} hint={t('gate.newVisitorHint')} onClick={() => setMode('new')} />
        <ActionTile tone="paper" icon={<QrCode className="size-7" aria-hidden />} title={t('gate.registeredCheckIn')} hint={t('gate.registeredCheckInHint')} onClick={() => setMode('checkin')} />
      </div>
      {inside.isError && <ErrorState error={inside.error} onRetry={() => void inside.refetch()} />}
      <InsideList inside={inside.data} gateId={gateId} />
      {board.isError && <ErrorState error={board.error} onRetry={() => void board.refetch()} />}
      <div className="grid grid-cols-1 gap-6">
        <BoardList
          title={t('gate.upcomingTitle')}
          icon={<CalendarClock className="size-5 text-amber-600" aria-hidden />}
          items={board.data?.upcoming}
          empty={t('gate.upcomingEmpty')}
          timeLabel={(i) => (i.at ? fmt.dateTime(i.at) : '')}
        />
        <BoardList
          title={t('gate.completedTitle')}
          icon={<CheckCircle2 className="size-5 text-emerald-700" aria-hidden />}
          items={board.data?.completedToday}
          empty={t('gate.completedEmpty')}
          timeLabel={(i) => [i.enteredAt && t('gate.since', { time: fmt.time(i.enteredAt) }), i.at && t('gate.exitedAt', { time: fmt.time(i.at) })].filter(Boolean).join(' · ')}
        />
      </div>

      <Dialog open={mode !== null} onClose={close} size="md" title={mode === 'checkin' ? t('gate.registeredCheckIn') : t('gate.newVisitor')}>
        {mode === 'new' && <EntryPanel key={prefill?.key ?? 0} gateId={gateId} prefillNumber={prefill?.number} onDone={() => void inside.refetch()} onClose={close} />}
        {mode === 'checkin' && (
          <CheckInPanel
            gateId={gateId}
            onDone={() => void inside.refetch()}
            onClose={close}
            onIdentity={(number) => {
              setPrefill({ number, key: Date.now() });
              setMode('new');
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
