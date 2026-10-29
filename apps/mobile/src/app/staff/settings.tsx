import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Switch } from 'react-native';
import { fieldErrorsFromIssues, normalizeDigits, systemSettingsSchema, type MessageKey, type SystemSettings } from '@vms/shared';
import { AppText, Banner, Button, Card, ErrorState, Field, Input, Loading, Row, Screen } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { colors, space } from '@/lib/theme';

const NUMBER_FIELDS = ['defaultVisitDurationMinutes', 'maxVisitDurationMinutes', 'entryWindowEarlyMinutes', 'entryWindowLateMinutes', 'maxAdvanceBookingDays', 'overdueGraceMinutes'] as const;

/** System settings (administrators): durations, entry window, booking horizon, overdue grace, validation. */
export default function Settings() {
  const { t } = useI18n();
  const qc = useQueryClient();
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
      Alert.alert(t('admin.settingsSaved'));
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!form) return <Loading />;
  const label = (k: keyof SystemSettings) => t(`admin.settingsFields.${k}` as MessageKey);
  return (
    <Screen edges={['bottom']}>
      <Banner tone="info">{t('admin.settingsHint')}</Banner>
      <Card style={{ gap: space.md }}>
        <Field label={label('compoundNameAr')} required error={fields.compoundNameAr}>
          <Input value={form.compoundNameAr} onChangeText={(v) => setForm({ ...form, compoundNameAr: v })} accessibilityLabel={label('compoundNameAr')} />
        </Field>
        <Field label={label('compoundNameEn')} required error={fields.compoundNameEn}>
          <Input value={form.compoundNameEn} onChangeText={(v) => setForm({ ...form, compoundNameEn: v })} accessibilityLabel={label('compoundNameEn')} ltrInput />
        </Field>
        <Field label={label('timezone')} required error={fields.timezone}>
          <Input value={form.timezone} onChangeText={(v) => setForm({ ...form, timezone: v })} accessibilityLabel={label('timezone')} ltrInput autoCapitalize="none" />
        </Field>
      </Card>
      <Card style={{ gap: space.md }}>
        {NUMBER_FIELDS.map((k) => (
          <Field key={k} label={label(k)} required error={fields[k]}>
            <Input value={String(form[k])} onChangeText={(v) => setForm({ ...form, [k]: Number(normalizeDigits(v).replace(/\D/g, '')) || 0 })} keyboardType="number-pad" accessibilityLabel={label(k)} />
          </Field>
        ))}
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText weight="bold" style={{ flex: 1 }}>
            {label('identityChecksumValidation')}
          </AppText>
          <Switch value={form.identityChecksumValidation} onValueChange={(v) => setForm({ ...form, identityChecksumValidation: v })} trackColor={{ true: colors.teal600 }} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText weight="bold" style={{ flex: 1 }}>
            {label('allowVisitorSelfRegistration')}
          </AppText>
          <Switch value={form.allowVisitorSelfRegistration} onValueChange={(v) => setForm({ ...form, allowVisitorSelfRegistration: v })} trackColor={{ true: colors.teal600 }} />
        </Row>
      </Card>
      {save.isError && !Object.keys(fields).length ? <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner> : null}
      <Button
        title={t('common.save')}
        size="lg"
        loading={save.isPending}
        onPress={() => {
          const parsed = systemSettingsSchema.safeParse(form);
          if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
          setFields({});
          save.mutate(parsed.data);
        }}
      />
    </Screen>
  );
}
