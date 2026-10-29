import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, LogOut, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { buildGateUrl, fieldErrorsFromIssues, gateSchema, type GateDTO } from '@vms/shared';
import { AppText, Badge, Banner, Button, Card, ErrorState, Field, Input, Loading, Row, Screen, TONES } from '@/components/ui';
import { QrCodeView } from '@/components/visit';
import { api, isApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { colors, flipX, ltr, space } from '@/lib/theme';

function GateForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState({ nameAr: '', nameEn: '', supportsEntry: true, supportsExit: true, isActive: true });
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api<GateDTO>('/gates', { body: form }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gates'] });
      onDone();
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="subheading">{t('admin.addGate')}</AppText>
      <Field label={t('fields.nameAr')} required error={fields.nameAr}>
        <Input value={form.nameAr} onChangeText={(nameAr) => setForm({ ...form, nameAr })} accessibilityLabel={t('fields.nameAr')} />
      </Field>
      <Field label={t('fields.nameEn')} required error={fields.nameEn}>
        <Input value={form.nameEn} onChangeText={(nameEn) => setForm({ ...form, nameEn })} accessibilityLabel={t('fields.nameEn')} ltrInput />
      </Field>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText weight="bold">{t('fields.supportsEntry')}</AppText>
        <Switch value={form.supportsEntry} onValueChange={(supportsEntry) => setForm({ ...form, supportsEntry })} trackColor={{ true: colors.teal600 }} />
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText weight="bold">{t('fields.supportsExit')}</AppText>
        <Switch value={form.supportsExit} onValueChange={(supportsExit) => setForm({ ...form, supportsExit })} trackColor={{ true: colors.teal600 }} />
      </Row>
      {fields.supportsEntry ? <Banner tone="danger">{t.dynamic(fields.supportsEntry)}</Banner> : null}
      <Button
        title={t('common.save')}
        loading={save.isPending}
        onPress={() => {
          const parsed = gateSchema.safeParse(form);
          if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
          if (!form.supportsEntry && !form.supportsExit) return setFields({ supportsEntry: 'validation.gateActionRequired' });
          save.mutate();
        }}
      />
      <Button title={t('common.cancel')} variant="secondary" onPress={onDone} />
    </Card>
  );
}

/** Gates with their printable entry/exit QR links (gate + action only; never authorizes entry). */
export default function Gates() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { data: config } = usePublicConfig();
  const [adding, setAdding] = useState(false);
  const gates = useQuery({ queryKey: ['gates', true], queryFn: () => api<{ items: GateDTO[] }>('/gates?all=true') });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api<GateDTO>(`/gates/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['gates'] }),
    onError: (err) => Alert.alert(isApiError(err) ? t.dynamic(err.messageKey) : t('errors.internal_error')),
  });
  if (gates.isLoading) return <Loading />;
  if (gates.isError) return <ErrorState error={gates.error} onRetry={() => void gates.refetch()} />;
  const origin = config?.appOrigin ?? '';
  return (
    <Screen edges={['bottom']} refreshing={gates.isRefetching} onRefresh={() => void gates.refetch()}>
      <Banner tone="info">{t('admin.gateQrNote')}</Banner>
      {adding ? <GateForm onDone={() => setAdding(false)} /> : <Button title={t('admin.addGate')} variant="accent" icon={<Plus size={18} color={colors.white} />} onPress={() => setAdding(true)} />}
      {gates.data?.items.map((g) => (
        <Card key={g.id} style={{ gap: space.md, opacity: g.isActive ? 1 : 0.7 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <AppText variant="subheading">{locale === 'ar' ? g.nameAr : g.nameEn}</AppText>
              <AppText variant="small">{`${t('fields.gateCode')}: ${ltr(g.code)}`}</AppText>
            </View>
            <Switch accessibilityLabel={t('common.active')} value={g.isActive} onValueChange={(isActive) => update.mutate({ id: g.id, body: { isActive } })} trackColor={{ true: colors.teal600 }} />
          </Row>
          <Row style={{ flexWrap: 'wrap' }}>
            {g.supportsEntry ? <Badge tone="teal" icon={<LogIn size={13} color={TONES.teal.fg} style={flipX()} />} label={t('scan.entry')} /> : null}
            {g.supportsExit ? <Badge tone="slate" icon={<LogOut size={13} color={TONES.slate.fg} style={flipX()} />} label={t('scan.exit')} /> : null}
          </Row>
          <Row style={{ justifyContent: 'space-around' }}>
            {(['entry', 'exit'] as const)
              .filter((a) => (a === 'entry' ? g.supportsEntry : g.supportsExit))
              .map((a) => (
                <View key={a} style={{ alignItems: 'center', gap: 4 }}>
                  <QrCodeView value={buildGateUrl(origin, g.code, a)} size={120} label={`${g.nameEn} ${a}`} />
                  <AppText weight="bold">{t(a === 'entry' ? 'scan.entry' : 'scan.exit')}</AppText>
                </View>
              ))}
          </Row>
          <Button
            title={t('admin.regenerateCode')}
            variant="ghost"
            size="sm"
            onPress={() =>
              Alert.alert(t('admin.regenerateCode'), t('admin.regenerateWarning'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.confirm'), style: 'destructive', onPress: () => update.mutate({ id: g.id, body: { regenerateCode: true } }) },
              ])
            }
          />
        </Card>
      ))}
    </Screen>
  );
}
