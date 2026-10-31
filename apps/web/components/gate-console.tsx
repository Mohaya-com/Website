'use client';

import { Camera, CheckCircle2, ChevronDown, ClipboardCopy, Clock, DoorOpen, Loader2, LogIn, LogOut, MessageCircle, RotateCcw, Search, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
} from '@vms/shared';
import { VillaNumberInput } from '@/components/inputs';
import { Dialog } from '@/components/ui/dialog';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Input, Segmented, Select } from '@/components/ui/form';
import { Badge, Button, Card, cn } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { prepareImage, type PreparedImage } from '@/lib/image';
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

// ───────────────────────────── Entry ─────────────────────────────

function EntryPanel({ gateId, onDone }: { gateId: string; onDone: () => void }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const camera = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [reading, setReading] = useState(false);
  const [villaNumber, setVillaNumber] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentKind, setDocumentKind] = useState<DocumentKind | null>(null);
  const [fullName, setFullName] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<QuickEntryCreatedDTO | null>(null);

  function reset() {
    setImage(null);
    setVillaNumber('');
    setDocumentNumber('');
    setDocumentKind(null);
    setFullName('');
    setShowDetails(false);
    setFields({});
    setCreated(null);
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setFields({});
    try {
      const prepared = await prepareImage(file);
      setImage(prepared);
      const res = await api<ArrivalScanResultDTO>('/gate/scan', { body: { idImage: { type: prepared.type, data: prepared.data } }, timeoutMs: 60_000 }).catch(() => null);
      const f = res?.fields;
      if (f?.documentNumber) setDocumentNumber(f.documentNumber);
      if (f?.documentKind) setDocumentKind(f.documentKind);
      if (f?.fullName) setFullName(f.fullName);
      if (f?.documentNumber || f?.fullName) setShowDetails(true);
      setTimeout(() => document.querySelector<HTMLInputElement>('#gate-villa-wrap input')?.focus(), 50);
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
      const errors = fieldErrorsFromIssues(parsed.error.issues);
      setFields(errors);
      if (errors.documentNumber || errors.fullName) setShowDetails(true);
      return;
    }
    save.mutate(body);
  }

  if (created) {
    const e = created.entry;
    return (
      <Card className="space-y-4 p-6 text-center animate-pop">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-700">
          <CheckCircle2 className="size-9" aria-hidden />
        </span>
        <div>
          <h2 className="text-xl font-extrabold text-navy-900">{t('gate.entered')}</h2>
          <p className="mt-1 text-lg font-bold text-navy-800">
            {t('gate.villaShort', { villa: e.villaNumber })}
            {e.fullName ? ` · ${e.fullName}` : ''}
          </p>
          <p className="mt-1 text-muted">{t('gate.enteredAt', { time: fmt.dateTime(e.enteredAt) })}</p>
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
        <Button size="lg" variant="accent" block icon={<RotateCcw className="size-5" aria-hidden />} onClick={reset}>
          {t('gate.newEntry')}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-5">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
      {image ? (
        <div className="relative overflow-hidden rounded-2xl border border-line bg-navy-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.previewUrl} alt={t('gate.photoCta')} className="mx-auto max-h-60 w-full object-contain" />
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
            'flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors',
            fields.idImage ? 'border-red-400 bg-red-50' : 'border-teal-300 bg-teal-50/60 hover:bg-teal-50',
          )}
        >
          {reading ? <Loader2 className="size-12 animate-spin text-teal-700" aria-hidden /> : <Camera className="size-12 text-teal-700" aria-hidden />}
          <span className="text-lg font-extrabold text-navy-900">{t('gate.photoCta')}</span>
          <span className="text-sm text-muted">{fields.idImage ? t('gate.photoRequired') : t('gate.photoHint')}</span>
        </button>
      )}

      <div id="gate-villa-wrap">
        <VillaNumberInput value={villaNumber} onChange={setVillaNumber} error={fields.villaNumber} large />
      </div>

      <div className="rounded-xl border border-line">
        <button type="button" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start font-semibold text-navy-900">
          <span className="flex items-center gap-2">
            <UserRound className="size-4 text-muted" aria-hidden />
            {t('gate.details')}
            {(documentNumber || fullName) && !showDetails && <span className="truncate text-sm font-normal text-muted">{fullName || documentNumber}</span>}
          </span>
          <ChevronDown className={cn('size-5 shrink-0 transition-transform', showDetails && 'rotate-180')} aria-hidden />
        </button>
        {showDetails && (
          <div className="space-y-4 border-t border-line p-4">
            <Field label={t('gate.documentNumber')} optional error={fields.documentNumber}>
              {(a) => <Input {...a} dir="ltr" autoComplete="off" className="ltr-nums font-semibold tracking-wider" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />}
            </Field>
            <Field label={t('gate.fullName')} optional error={fields.fullName}>
              {(a) => <Input {...a} autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} />}
            </Field>
          </div>
        )}
      </div>

      {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
      <Button size="lg" variant="accent" block loading={save.isPending} disabled={reading} icon={<LogIn className="size-5 rtl:-scale-x-100" aria-hidden />} onClick={submit}>
        {t('gate.recordEntry')}
      </Button>
    </Card>
  );
}

// ───────────────────────────── Exit ─────────────────────────────

interface InsideItem {
  key: string;
  kind: 'entry' | 'visit';
  id: string;
  name: string;
  villaNumber: string;
  enteredAt: string;
  entry?: QuickEntryDTO;
}

function ExitPanel({ inside, gateId }: { inside: InsideNowDTO | undefined; gateId: string }) {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<InsideItem | null>(null);

  const items = useMemo<InsideItem[]>(() => {
    if (!inside) return [];
    const list: InsideItem[] = [
      ...inside.entries.map((e) => ({
        // Everything in the inside list has been entered.
        key: `e-${e.id}`,
        kind: 'entry' as const,
        id: e.id,
        name: e.fullName ?? (e.documentNumber ? `${t('gate.unnamed')} · ${e.documentNumber}` : t('gate.unnamed')),
        villaNumber: e.villaNumber,
        enteredAt: e.enteredAt ?? '',
        entry: e,
      })),
      ...inside.visits.map((v) => ({ key: `v-${v.id}`, kind: 'visit' as const, id: v.id, name: v.fullName, villaNumber: v.villaNumber, enteredAt: v.checkedInAt })),
    ];
    const needle = q.trim().toLowerCase();
    return list
      .filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.villaNumber.toLowerCase().includes(needle))
      .sort((a, b) => (a.enteredAt < b.enteredAt ? 1 : -1));
  }, [inside, q, t]);

  const exit = useMutation({
    mutationFn: async (item: InsideItem) => {
      if (item.kind === 'entry') return api(`/gate/entries/${item.id}/exit`, { method: 'POST', body: {} });
      return api('/scan/confirm', { body: { visitId: item.id, gateId, action: 'exit' } });
    },
    onSuccess: (_res, item) => {
      toast(t('gate.exitDone', { name: item.name }));
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ['gate'] });
      void qc.invalidateQueries({ queryKey: ['inside'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <Input aria-label={t('gate.search')} placeholder={t('gate.search')} className="h-12 ps-10 text-base" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!inside ? (
        <LoadingRows rows={4} />
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<DoorOpen className="size-7" aria-hidden />} title={t('gate.emptyInside')} />
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => setSelected(item)}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3 text-start shadow-sm transition-colors hover:border-teal-400 hover:bg-teal-50/40 active:scale-[0.99]"
              >
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
                <LogOut className="size-6 shrink-0 text-teal-700 rtl:-scale-x-100" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? t('gate.exitConfirmTitle', { name: selected.name }) : ''}
        description={selected ? t('gate.exitConfirmBody', { villa: selected.villaNumber, time: fmt.time(selected.enteredAt) }) : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" loading={exit.isPending} onClick={() => selected && exit.mutate(selected)} icon={<LogOut className="size-5 rtl:-scale-x-100" aria-hidden />}>
              {t('gate.exitButton')}
            </Button>
          </>
        }
      >
        {exit.isError && <Banner tone="danger">{isApiError(exit.error) ? t.dynamic(exit.error.messageKey) : t('errors.internal_error')}</Banner>}
      </Dialog>
    </div>
  );
}

// ───────────────────────────── Page ─────────────────────────────

/** The gate screen for security: photograph the ID and type the villa to enter; tap a name to exit. */
export function GateConsole() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'entry' | 'exit'>('entry');
  const gates = useQuery({ queryKey: ['gates', 'active'], queryFn: () => api<{ items: GateDTO[] }>('/gates') });
  const activeGates = gates.data?.items.filter((g) => g.isActive);
  const [gateId, setGateId] = useGateChoice(activeGates);
  const inside = useQuery({ queryKey: ['gate', 'inside'], queryFn: () => api<InsideNowDTO>('/gate/inside'), refetchInterval: 30_000 });
  const count = (inside.data?.entries.length ?? 0) + (inside.data?.visits.length ?? 0);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-navy-900">{t('gate.title')}</h1>
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
      <div className="mb-4">
        <Segmented
          label={t('gate.title')}
          size="lg"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'entry', label: t('gate.entryTab') },
            { value: 'exit', label: `${t('gate.exitTab')}${count ? ` (${count})` : ''}` },
          ]}
        />
      </div>
      {inside.isError && <ErrorState error={inside.error} onRetry={() => void inside.refetch()} />}
      {tab === 'entry' ? <EntryPanel gateId={gateId} onDone={() => void inside.refetch()} /> : <ExitPanel inside={inside.data} gateId={gateId} />}
    </div>
  );
}
