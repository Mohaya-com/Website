'use client';

import { CheckCircle2, ClipboardCopy, MessageCircle, RotateCcw, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fieldErrorsFromIssues, inviteSchema, zonedDateString, zonedDateTimeToUtc, zonedTimeString, type InviteCreatedDTO } from '@vms/shared';
import { QrCode } from '@/components/qr-code';
import { Banner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Button, Card, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** A resident registers an expected visitor; the visitor gets a QR the gate scans (no approval needed). */
export default function InvitePage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [date, setDate] = useState(zonedDateString(now, fmt.tz));
  const [time, setTime] = useState(zonedTimeString(new Date(now.getTime() + 30 * 60_000), fmt.tz));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<InviteCreatedDTO | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) => api<InviteCreatedDTO>('/resident/invites', { body }),
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
    const body = { fullName, mobile: mobile || null, expectedAt };
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
            setFullName('');
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
        <Field label={t('resident.visitorName')} required error={fields.fullName}>
          {(a) => <Input {...a} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />}
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
