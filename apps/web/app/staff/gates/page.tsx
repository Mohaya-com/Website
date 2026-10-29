'use client';

import { LogIn, LogOut, Pencil, Plus, Printer, RefreshCcw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildGateUrl, fieldErrorsFromIssues, gateSchema, type GateDTO } from '@vms/shared';
import { QrCode } from '@/components/qr-code';
import { Dialog } from '@/components/ui/dialog';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Switch } from '@/components/ui/form';
import { Badge, Button, ButtonLink, Card, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useGates } from '@/components/visit-filters';
import { api, isApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

type GateForm = { nameAr: string; nameEn: string; supportsEntry: boolean; supportsExit: boolean; isActive: boolean };

function GateDialog({ gate, open, onClose }: { gate: GateDTO | null; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<GateForm>(gate ?? { nameAr: '', nameEn: '', supportsEntry: true, supportsExit: true, isActive: true });
  const [regenerate, setRegenerate] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (gate ? api<GateDTO>(`/gates/${gate.id}`, { method: 'PATCH', body: { ...form, regenerateCode: regenerate } }) : api<GateDTO>('/gates', { body: form })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gates'] });
      toast(t('admin.saved'));
      onClose();
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });
  const submit = () => {
    const parsed = gateSchema.safeParse(form);
    if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
    if (!form.supportsEntry && !form.supportsExit) return setFields({ supportsEntry: 'validation.gateActionRequired' });
    setFields({});
    save.mutate();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={gate ? t('admin.editGate') : t('admin.addGate')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
        <Field label={t('fields.nameAr')} required error={fields.nameAr}>
          {(a) => <Input {...a} dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />}
        </Field>
        <Field label={t('fields.nameEn')} required error={fields.nameEn}>
          {(a) => <Input {...a} dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />}
        </Field>
        <Switch checked={form.supportsEntry} onChange={(v) => setForm({ ...form, supportsEntry: v })} label={t('fields.supportsEntry')} />
        <Switch checked={form.supportsExit} onChange={(v) => setForm({ ...form, supportsExit: v })} label={t('fields.supportsExit')} />
        {fields.supportsEntry && <p className="text-sm font-medium text-red-700">{t.dynamic(fields.supportsEntry)}</p>}
        <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label={t('common.active')} />
        {gate && <Checkbox checked={regenerate} onChange={setRegenerate} label={t('admin.regenerateCode')} description={t('admin.regenerateWarning')} />}
      </div>
    </Dialog>
  );
}

export default function GatesPage() {
  const { t, locale } = useI18n();
  const gates = useGates(true);
  const { data: config } = usePublicConfig();
  const [editing, setEditing] = useState<GateDTO | null>(null);
  const [open, setOpen] = useState(false);
  const origin = config?.appOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return (
    <div>
      <PageHeader
        title={t('admin.gatesTitle')}
        subtitle={t('admin.gateQrNote')}
        actions={
          <Button
            variant="accent"
            icon={<Plus className="size-5" aria-hidden />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            {t('admin.addGate')}
          </Button>
        }
      />
      {gates.isLoading ? (
        <LoadingRows />
      ) : gates.isError ? (
        <ErrorState error={gates.error} onRetry={() => void gates.refetch()} />
      ) : !gates.data?.items.length ? (
        <Card>
          <EmptyState icon={<ShieldCheck className="size-7" aria-hidden />} title={t('common.noResults')} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {gates.data.items.map((g) => (
            <Card key={g.id} className={g.isActive ? '' : 'opacity-70'}>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
                <div>
                  <h2 className="text-lg font-extrabold text-navy-900">{locale === 'ar' ? g.nameAr : g.nameEn}</h2>
                  <p className="text-sm text-muted">{locale === 'ar' ? g.nameEn : g.nameAr}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={g.isActive ? 'green' : 'neutral'}>{g.isActive ? t('common.active') : t('common.inactive')}</Badge>
                    {g.supportsEntry && <Badge tone="teal" icon={<LogIn className="size-3.5 rtl:-scale-x-100" aria-hidden />}>{t('scan.entry')}</Badge>}
                    {g.supportsExit && <Badge tone="slate" icon={<LogOut className="size-3.5 rtl:-scale-x-100" aria-hidden />}>{t('scan.exit')}</Badge>}
                    <Badge tone="navy">
                      {t('fields.gateCode')}: <span className="ltr-nums">{g.code}</span>
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Pencil className="size-4" aria-hidden />}
                    onClick={() => {
                      setEditing(g);
                      setOpen(true);
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <ButtonLink href={`/staff/gates/${g.id}/print`} size="sm" variant="secondary" icon={<Printer className="size-4" aria-hidden />} target="_blank">
                    {t('admin.printQr')}
                  </ButtonLink>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 p-5">
                {(['entry', 'exit'] as const)
                  .filter((a) => (a === 'entry' ? g.supportsEntry : g.supportsExit))
                  .map((a) => (
                    <figure key={a} className="flex flex-col items-center gap-2 rounded-2xl border border-line p-3">
                      <QrCode value={buildGateUrl(origin, g.code, a)} size={150} label={`${locale === 'ar' ? g.nameAr : g.nameEn} — ${t(a === 'entry' ? 'scan.entry' : 'scan.exit')}`} />
                      <figcaption className="text-sm font-bold text-navy-900">{t(a === 'entry' ? 'scan.entry' : 'scan.exit')}</figcaption>
                    </figure>
                  ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-6 flex items-center gap-2 text-xs text-muted">
        <RefreshCcw className="size-3.5" aria-hidden />
        {t('admin.regenerateWarning')}
      </p>
      {open && <GateDialog key={editing?.id ?? 'new'} gate={editing} open={open} onClose={() => setOpen(false)} />}
    </div>
  );
}
