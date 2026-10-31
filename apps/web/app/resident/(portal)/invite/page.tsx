'use client';

import { Camera, CheckCircle2, ClipboardCopy, Loader2, MessageCircle, RotateCcw, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fieldErrorsFromIssues, inviteSchema, zonedDateString, zonedDateTimeToUtc, zonedTimeString, type ArrivalScanResultDTO, type DocumentKind, type InviteCreatedDTO } from '@vms/shared';
import { QrCode } from '@/components/qr-code';
import { Banner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Button, Card, PageHeader, cn } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { prepareIdPhoto, type PreparedImage } from '@/lib/image';
import { useI18n } from '@/lib/i18n';

/**
 * A resident registers an expected visitor with a photo of their ID (details read from it or typed). The
 * visit is approved at once; the visitor gets a QR the gate scans to let them in.
 */
export default function InvitePage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const camera = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<'nameMissing' | 'failed' | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentKind, setDocumentKind] = useState<DocumentKind | null>(null);
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [date, setDate] = useState(zonedDateString(now, fmt.tz));
  const [time, setTime] = useState(zonedTimeString(new Date(now.getTime() + 30 * 60_000), fmt.tz));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<InviteCreatedDTO | null>(null);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setReadNote(null);
    setFields((f) => ({ ...f, idImage: '' }));
    try {
      const prepared = await prepareIdPhoto(file);
      setImage(prepared);
      const res = await api<ArrivalScanResultDTO>('/resident/scan', { body: { idImage: prepared.reading }, timeoutMs: 90_000 }).catch(() => null);
      const f = res?.fields;
      if (f?.fullName) setFullName(f.fullName);
      if (f?.documentNumber) setDocumentNumber(f.documentNumber);
      if (f?.documentKind) setDocumentKind(f.documentKind);
      setReadNote(!res ? 'failed' : f?.fullName ? null : 'nameMissing');
    } finally {
      setReading(false);
      if (camera.current) camera.current.value = '';
    }
  }

  const save = useMutation({
    mutationFn: (body: unknown) => api<InviteCreatedDTO>('/resident/invites', { body, timeoutMs: 60_000 }),
    onSuccess: (res) => {
      setCreated(res);
      void qc.invalidateQueries({ queryKey: ['resident'] });
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });

  function submit() {
    let expectedAt = '';
    try {
      expectedAt = zonedDateTimeToUtc(date, time, fmt.tz).toISOString();
    } catch {
      // invalid date: reported by the schema below
    }
    const body = { idImage: image ? { type: image.type, data: image.data } : undefined, fullName, documentNumber, documentKind, mobile: mobile || null, expectedAt };
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
    setFields({});
    save.mutate(body);
  }

  if (created) {
    return (
      <Card className="mx-auto max-w-md space-y-4 p-6 text-center animate-pop">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
          <CheckCircle2 className="size-8" aria-hidden />
        </span>
        <h1 className="text-xl font-extrabold text-navy-900">{t('resident.inviteCreated')}</h1>
        <p className="font-bold text-navy-800">{created.invite.fullName}</p>
        {created.invite.expectedAt && <p className="text-muted">{t('resident.expectedAt', { time: fmt.dateTime(created.invite.expectedAt) })}</p>}
        <div className="flex justify-center">
          <div className="rounded-2xl border border-line p-3">
            <QrCode value={created.inviteLink} size={200} label={t('invitePass.show')} />
          </div>
        </div>
        {created.whatsappUrl && (
          <a href={created.whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 font-semibold text-white hover:bg-emerald-700">
            <MessageCircle className="size-5" aria-hidden />
            {t('resident.sendWhatsapp')}
          </a>
        )}
        <Button variant="secondary" block icon={<ClipboardCopy className="size-5" aria-hidden />} onClick={() => void navigator.clipboard?.writeText(created.inviteLink).then(() => toast(t('common.copied'), 'info'))}>
          {t('resident.copyLink')}
        </Button>
        <Button
          variant="ghost"
          block
          icon={<RotateCcw className="size-5" aria-hidden />}
          onClick={() => {
            setCreated(null);
            setImage(null);
            setReadNote(null);
            setFullName('');
            setDocumentNumber('');
            setDocumentKind(null);
            setMobile('');
          }}
        >
          {t('resident.newInvite')}
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t('resident.inviteTitle')} subtitle={t('resident.inviteSubtitle')} />
      <Card className="space-y-5 p-5">
        {/* No capture attribute: the resident can take a photo or pick one they were sent. */}
        <input ref={camera} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
        {image ? (
          <div className="relative overflow-hidden rounded-2xl border border-line bg-navy-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.previewUrl} alt={t('resident.idPhoto')} className="mx-auto max-h-56 w-full object-contain" />
            {reading && (
              <div className="absolute inset-0 grid place-items-center bg-white/70" role="status">
                <span className="flex items-center gap-2 font-semibold text-teal-800">
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                  {t('gate.reading')}
                </span>
              </div>
            )}
            <button type="button" onClick={() => camera.current?.click()} className="absolute bottom-2 end-2 flex items-center gap-1.5 rounded-full bg-navy-900/85 px-3 py-1.5 text-sm font-semibold text-white">
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
              'flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors',
              fields.idImage ? 'border-red-400 bg-red-50' : 'border-teal-300 bg-teal-50/60 hover:bg-teal-50',
            )}
          >
            {reading ? <Loader2 className="size-10 animate-spin text-teal-700" aria-hidden /> : <Camera className="size-10 text-teal-700" aria-hidden />}
            <span className="font-extrabold text-navy-900">
              {t('resident.idPhoto')} <span className="text-red-700" aria-hidden>*</span>
            </span>
            <span className="text-sm text-muted">{fields.idImage ? t('resident.idPhotoRequired') : t('resident.idPhotoHint')}</span>
          </button>
        )}
        {readNote && <Banner tone="warning">{t(readNote === 'failed' ? 'gate.readFailed' : 'gate.nameNotRead')}</Banner>}
        <Field label={t('resident.visitorName')} required error={fields.fullName}>
          {(a) => <Input {...a} value={fullName} onChange={(e) => setFullName(e.target.value)} />}
        </Field>
        <Field label={t('gate.documentNumber')} optional error={fields.documentNumber}>
          {(a) => <Input {...a} dir="ltr" autoComplete="off" className="ltr-nums tracking-wider" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />}
        </Field>
        <Field label={t('resident.visitorMobile')} error={fields.mobile} hint={t('resident.visitorMobileHint')}>
          {(a) => <Input {...a} type="tel" inputMode="tel" dir="ltr" placeholder="05X XXX XXXX" className="ltr-nums" value={mobile} onChange={(e) => setMobile(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('resident.expectedDate')} required error={fields.expectedAt}>
            {(a) => <Input {...a} type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label={t('resident.expectedTime')} required>
            {(a) => <Input {...a} type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />}
          </Field>
        </div>
        {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
        <Button size="lg" variant="accent" block loading={save.isPending} icon={<UserPlus className="size-5" aria-hidden />} onClick={submit}>
          {t('resident.createInvite')}
        </Button>
      </Card>
    </div>
  );
}
