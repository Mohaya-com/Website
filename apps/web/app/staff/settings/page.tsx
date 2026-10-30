'use client';

import { Clock, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldErrorsFromIssues, normalizeDigits, systemSettingsSchema, type MessageKey, type SystemSettings } from '@vms/shared';
import { Banner, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Input, Switch } from '@/components/ui/form';
import { Button, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { WhatsAppSettings } from '@/components/whatsapp-settings';

const NUMBER_FIELDS = ['defaultVisitDurationMinutes', 'maxVisitDurationMinutes', 'entryWindowEarlyMinutes', 'entryWindowLateMinutes', 'maxAdvanceBookingDays', 'overdueGraceMinutes'] as const;

export default function SettingsPage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<SystemSettings>('/settings') });
  const [form, setForm] = useState<SystemSettings | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data && !form) setForm(q.data);
  }, [q.data, form]);
  const save = useMutation({
    mutationFn: (body: SystemSettings) => api<SystemSettings>('/settings', { method: 'PUT', body }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      void qc.invalidateQueries({ queryKey: ['config'] });
      toast(t('admin.settingsSaved'));
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });

  if (q.isLoading || !form) return q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <LoadingRows />;
  const label = (k: keyof SystemSettings) => t(`admin.settingsFields.${k}` as MessageKey);

  return (
    <div>
      <PageHeader title={t('admin.settingsTitle')} subtitle={t('admin.settingsHint')} />
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = systemSettingsSchema.safeParse(form);
          if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
          setFields({});
          save.mutate(parsed.data);
        }}
      >
        <Card>
          <CardHeader title={t('admin.sections.management')} icon={<Settings className="size-5" aria-hidden />} />
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <Field label={label('compoundNameAr')} required error={fields.compoundNameAr}>
              {(a) => <Input {...a} dir="rtl" value={form.compoundNameAr} onChange={(e) => setForm({ ...form, compoundNameAr: e.target.value })} />}
            </Field>
            <Field label={label('compoundNameEn')} required error={fields.compoundNameEn}>
              {(a) => <Input {...a} dir="ltr" value={form.compoundNameEn} onChange={(e) => setForm({ ...form, compoundNameEn: e.target.value })} />}
            </Field>
            <Field label={label('timezone')} required error={fields.timezone} hint={`${fmt.dateTime(new Date())}`}>
              {(a) => <Input {...a} dir="ltr" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />}
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title={t('fields.duration')} icon={<Clock className="size-5" aria-hidden />} />
          <div className="grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-3">
            {NUMBER_FIELDS.map((k) => (
              <Field key={k} label={label(k)} required error={fields[k]}>
                {(a) => (
                  <Input
                    {...a}
                    dir="ltr"
                    inputMode="numeric"
                    value={String(form[k])}
                    onChange={(e) => setForm({ ...form, [k]: Number(normalizeDigits(e.target.value).replace(/\D/g, '')) || 0 })}
                  />
                )}
              </Field>
            ))}
          </div>
          <div className="divide-y divide-line border-t border-line px-5 py-2">
            <Switch checked={form.identityChecksumValidation} onChange={(v) => setForm({ ...form, identityChecksumValidation: v })} label={label('identityChecksumValidation')} />
            <Switch checked={form.allowVisitorSelfRegistration} onChange={(v) => setForm({ ...form, allowVisitorSelfRegistration: v })} label={label('allowVisitorSelfRegistration')} />
            <Switch checked={form.allowArrivalRegistration} onChange={(v) => setForm({ ...form, allowArrivalRegistration: v })} label={label('allowArrivalRegistration')} />
          </div>
        </Card>
        {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
        <div className="flex justify-end">
          <Button type="submit" size="lg" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
      <div className="mt-8">
        <WhatsAppSettings />
      </div>
    </div>
  );
}
