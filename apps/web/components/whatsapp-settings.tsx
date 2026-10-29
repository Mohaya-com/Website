'use client';

import { ChevronRight, ExternalLink, MessageCircle, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type MessageKey, type WhatsAppStatusDTO, type WhatsAppTestResultDTO } from '@vms/shared';
import { PhoneInput, type PhoneValue } from '@/components/inputs';
import { Dialog } from '@/components/ui/dialog';
import { Banner, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { Badge, Button, Card, CardHeader, type Tone } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

const KEY = ['settings', 'whatsapp'];
const TEMPLATE_LANGUAGES = ['ar', 'en', 'en_US'] as const;
const STATUS_TONE: Record<string, Tone> = { APPROVED: 'green', PENDING: 'amber', REJECTED: 'red' };

interface FormState {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
}

function formFrom(s: WhatsAppStatusDTO): FormState {
  return { phoneNumberId: s.phoneNumberId ?? '', businessAccountId: s.businessAccountId ?? '', accessToken: '', templateName: s.templateName, templateLanguage: s.templateLanguage };
}

/** English text from Meta, isolated so it does not reorder the surrounding Arabic. */
function MetaDetail({ detail }: { detail: string | null | undefined }) {
  const { t } = useI18n();
  if (!detail) return null;
  return (
    <span className="mt-1 block text-xs opacity-90">
      {t('admin.whatsapp.detail')}{' '}
      <bdi dir="ltr" className="font-mono">
        {detail}
      </bdi>
    </span>
  );
}

/** Explains an API error, adding Meta's own message when the server passed one along. */
function ErrorBanner({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!isApiError(error)) return <Banner tone="danger">{t('errors.internal_error')}</Banner>;
  return (
    <Banner tone="danger">
      {t.dynamic(error.messageKey)}
      <MetaDetail detail={typeof error.details.detail === 'string' ? error.details.detail : null} />
    </Banner>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <span dir="ltr" className="mt-1.5 flex flex-wrap items-center gap-1.5 rtl:justify-end">
      {items.map((item, i) => (
        <span key={item} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight aria-hidden className="size-3.5 text-muted" />}
          <code className="rounded-md border border-line bg-white px-1.5 py-0.5 text-xs font-semibold text-navy-900">{item}</code>
        </span>
      ))}
    </span>
  );
}

export function WhatsAppSettings() {
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<WhatsAppStatusDTO>('/settings/whatsapp') });
  const [form, setForm] = useState<FormState | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState<PhoneValue>({ country: 'SA', number: '' });
  const [testFields, setTestFields] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (q.data && !form) setForm(formFrom(q.data));
  }, [q.data, form]);

  const onStatus = (s: WhatsAppStatusDTO) => {
    qc.setQueryData(KEY, s);
    void qc.invalidateQueries({ queryKey: ['config'] });
  };
  const save = useMutation({
    mutationFn: (body: FormState) => api<WhatsAppStatusDTO>('/settings/whatsapp', { method: 'PUT', body }),
    onSuccess: (s) => {
      onStatus(s);
      setForm(formFrom(s));
      setFields({});
      toast(t('admin.whatsapp.saved'));
    },
    onError: (err) => setFields(isApiError(err) ? err.fields : {}),
  });
  const refresh = useMutation({ mutationFn: () => api<WhatsAppStatusDTO>('/settings/whatsapp/refresh', { method: 'POST', body: {} }), onSuccess: onStatus });
  const enable = useMutation({
    mutationFn: (enabled: boolean) => api<WhatsAppStatusDTO>('/settings/whatsapp/enabled', { method: 'POST', body: { enabled } }),
    onSuccess: (s) => {
      onStatus(s);
      toast(s.enabled ? t('admin.whatsapp.enabledToast') : t('admin.whatsapp.disabledToast'));
    },
    onError: () => void q.refetch(),
  });
  const test = useMutation({
    mutationFn: () => api<WhatsAppTestResultDTO>('/settings/whatsapp/test', { method: 'POST', body: { mobile: phone.number, mobileCountry: phone.country } }),
    onSuccess: () => {
      setTestFields({});
      toast(t('admin.whatsapp.testSent'));
      void q.refetch();
    },
    onError: (err) => {
      setTestFields(isApiError(err) ? err.fields : {});
      void q.refetch();
    },
  });
  const remove = useMutation({
    mutationFn: () => api<WhatsAppStatusDTO>('/settings/whatsapp', { method: 'DELETE', body: {} }),
    onSuccess: (s) => {
      onStatus(s);
      setForm(formFrom(s));
      setConfirmRemove(false);
      toast(t('admin.whatsapp.removed'));
    },
  });

  if (q.isLoading || !form) return <Card>{q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <LoadingRows rows={3} />}</Card>;
  const s = q.data!;
  const statusKey = (s.templateStatus && ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'MISSING'].includes(s.templateStatus) ? s.templateStatus : 'unknown') as string;
  const envOverride = s.environmentProvider !== 'disabled';

  return (
    <Card>
      <CardHeader title={t('admin.whatsapp.title')} subtitle={t('admin.whatsapp.subtitle')} icon={<MessageCircle className="size-5" aria-hidden />} />
      <div className="space-y-5 p-5">
        {envOverride ? (
          <Banner tone="warning">{t('admin.whatsapp.envOverride', { provider: s.environmentProvider })}</Banner>
        ) : (
          <Banner tone={s.active ? 'success' : 'info'}>{s.active ? t('admin.whatsapp.active') : t('admin.whatsapp.inactive')}</Banner>
        )}
        {s.configured && !s.tokenReadable && <Banner tone="warning">{t('admin.whatsapp.tokenUnreadable')}</Banner>}
        {s.lastDeliveryError && (
          <Banner tone="danger">
            {t('admin.whatsapp.lastDeliveryError', { time: fmt.dateTime(s.lastDeliveryError.at) })}
            <MetaDetail detail={s.lastDeliveryError.error} />
          </Banner>
        )}

        <section aria-labelledby="wa-steps" className="rounded-xl border border-line bg-navy-50/50 p-4">
          <h3 id="wa-steps" className="font-bold text-navy-900">
            {t('admin.whatsapp.stepsTitle')}
          </h3>
          <ol className="mt-2 list-decimal space-y-1.5 ps-5 text-sm leading-relaxed text-muted">
            <li>
              {t('admin.whatsapp.step1')}
              <Chips items={['developers.facebook.com', 'My Apps', t('admin.whatsapp.yourApp'), 'WhatsApp', 'API Setup']} />
            </li>
            <li>
              {t('admin.whatsapp.step2')}
              <span dir="ltr" className="mt-1.5 flex flex-wrap gap-1.5 rtl:justify-end">
                <code className="rounded-md border border-line bg-white px-1.5 py-0.5 text-xs font-semibold text-navy-900">Phone number ID</code>
                <code className="rounded-md border border-line bg-white px-1.5 py-0.5 text-xs font-semibold text-navy-900">WhatsApp Business Account ID</code>
              </span>
            </li>
            <li>
              {t('admin.whatsapp.step3')}
              <Chips items={['Generate access token']} />
            </li>
            <li>{t('admin.whatsapp.step4')}</li>
          </ol>
          <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 underline-offset-4 hover:underline">
            {t('admin.whatsapp.openMeta')}
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </section>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label={t('admin.whatsapp.phoneNumberId')} required error={fields.phoneNumberId}>
              {(a) => <Input {...a} dir="ltr" inputMode="numeric" autoComplete="off" className="ltr-nums" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} />}
            </Field>
            <Field label={t('admin.whatsapp.businessAccountId')} required error={fields.businessAccountId}>
              {(a) => <Input {...a} dir="ltr" inputMode="numeric" autoComplete="off" className="ltr-nums" value={form.businessAccountId} onChange={(e) => setForm({ ...form, businessAccountId: e.target.value })} />}
            </Field>
            <Field
              label={t('admin.whatsapp.accessToken')}
              required={!s.tokenHint || !s.tokenReadable}
              error={fields.accessToken}
              hint={s.tokenHint && s.tokenReadable ? t('admin.whatsapp.accessTokenKeep', { hint: s.tokenHint }) : undefined}
              className="md:col-span-2"
            >
              {(a) => <Input {...a} type="password" dir="ltr" autoComplete="off" spellCheck={false} value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value.trim() })} />}
            </Field>
          </div>
          <details className="rounded-xl border border-line px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-navy-800">{t('admin.whatsapp.advanced')}</summary>
            <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label={t('admin.whatsapp.templateLanguage')} error={fields.templateLanguage}>
                {(a) => (
                  <Select {...a} value={form.templateLanguage} onChange={(e) => setForm({ ...form, templateLanguage: e.target.value })}>
                    {TEMPLATE_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {t(`admin.whatsapp.languages.${l}` as MessageKey)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('admin.whatsapp.templateName')} error={fields.templateName}>
                {(a) => <Input {...a} dir="ltr" autoComplete="off" value={form.templateName} onChange={(e) => setForm({ ...form, templateName: e.target.value.trim() })} />}
              </Field>
            </div>
          </details>
          {save.isError && !Object.keys(fields).length && <ErrorBanner error={save.error} />}
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending}>
              {t('admin.whatsapp.saveVerify')}
            </Button>
          </div>
        </form>

        {s.configured && (
          <>
            <div className="grid grid-cols-1 gap-4 border-t border-line pt-5 md:grid-cols-2">
              <div>
                <p className="text-sm text-muted">{t('admin.whatsapp.connectedAs')}</p>
                <p className="mt-1 font-bold text-navy-900">
                  <span dir="ltr" className="ltr-nums">
                    {s.displayPhoneNumber ?? '—'}
                  </span>
                  {s.verifiedName && <span className="ms-2 font-medium text-muted">({s.verifiedName})</span>}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted">{t('admin.whatsapp.template')}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono text-sm">
                    {s.templateName} · {s.templateLanguage}
                  </span>
                  <Badge tone={STATUS_TONE[statusKey] ?? 'slate'}>{t(`admin.whatsapp.templateStatus.${statusKey}` as MessageKey)}</Badge>
                  <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" aria-hidden />} loading={refresh.isPending} onClick={() => refresh.mutate()}>
                    {t('admin.whatsapp.refresh')}
                  </Button>
                </div>
                {s.checkedAt && <p className="mt-1 text-xs text-muted">{t('admin.whatsapp.checkedAt', { time: fmt.dateTime(s.checkedAt) })}</p>}
              </div>
            </div>
            {statusKey === 'REJECTED' && <Banner tone="warning">{t('admin.whatsapp.templateRejectedHint')}</Banner>}
            {refresh.isError && <ErrorBanner error={refresh.error} />}

            <div className="space-y-3 border-t border-line pt-5">
              <h3 className="font-bold text-navy-900">{t('admin.whatsapp.testTitle')}</h3>
              <p className="text-sm text-muted">{t('admin.whatsapp.testHint')}</p>
              <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto]">
                <PhoneInput value={phone} onChange={setPhone} error={testFields.mobile} />
                <Button variant="secondary" icon={<Send className="size-4 rtl:-scale-x-100" aria-hidden />} loading={test.isPending} onClick={() => test.mutate()} className="md:mb-6">
                  {t('admin.whatsapp.sendTest')}
                </Button>
              </div>
              {test.isError && !Object.keys(testFields).length && <ErrorBanner error={test.error} />}
              {s.lastTest && (
                <p className={s.lastTest.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>
                  {s.lastTest.ok ? t('admin.whatsapp.lastTestOk', { time: fmt.dateTime(s.lastTest.at) }) : t('admin.whatsapp.lastTestFailed', { time: fmt.dateTime(s.lastTest.at) })}
                  {!s.lastTest.ok && <MetaDetail detail={s.lastTest.error} />}
                </p>
              )}
            </div>

            <div className="border-t border-line pt-3">
              <Switch checked={s.enabled} onChange={(v) => !enable.isPending && enable.mutate(v)} label={t('admin.whatsapp.enableLabel')} />
              {enable.isError && <ErrorBanner error={enable.error} />}
            </div>

            <div className="flex justify-end border-t border-line pt-4">
              <Button variant="ghost" className="text-red-700" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirmRemove(true)}>
                {t('admin.whatsapp.remove')}
              </Button>
            </div>
          </>
        )}
      </div>
      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={t('admin.whatsapp.removeConfirmTitle')}
        description={t('admin.whatsapp.removeConfirmBody')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              {t('admin.whatsapp.remove')}
            </Button>
          </>
        }
      />
    </Card>
  );
}
