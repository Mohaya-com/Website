import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { KeyRound, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { fieldErrorsFromIssues, staffUserCreateSchema, type StaffRole, type StaffUserDTO } from '@vms/shared';
import { AppText, Badge, Banner, Button, Card, ErrorState, Field, Input, Loading, Row, Screen, Segmented } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, ltr, space } from '@/lib/theme';

/** Staff accounts: create (temporary password shown once), role/activation, password reset. */
export default function Users() {
  const { t } = useI18n();
  const fmt = useFormat();
  const qc = useQueryClient();
  const { session } = useSession();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ username: '', fullName: '', role: 'security' as StaffRole });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['users'], queryFn: () => api<{ items: StaffUserDTO[] }>('/users') });
  const onError = (err: unknown) => Alert.alert(isApiError(err) ? t.dynamic(err.messageKey) : t('errors.internal_error'));
  const create = useMutation({
    mutationFn: () => api<{ user: StaffUserDTO; temporaryPassword: string | null }>('/users', { body: form }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setAdding(false);
      setForm({ username: '', fullName: '', role: 'security' });
      setTempPassword(res.temporaryPassword);
    },
    onError: (err) => (isApiError(err) && Object.keys(err.fields).length ? setFields(err.fields) : onError(err)),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api<StaffUserDTO>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
    onError,
  });
  const reset = useMutation({ mutationFn: (id: string) => api<{ temporaryPassword: string }>(`/users/${id}/reset-password`, { method: 'POST' }), onSuccess: (r) => setTempPassword(r.temporaryPassword), onError });

  if (list.isLoading) return <Loading />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <Screen edges={['bottom']} refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      {tempPassword ? (
        <Banner tone="success" title={t('admin.tempPasswordTitle')} action={<Button title={t('common.copy')} variant="ghost" size="sm" onPress={() => void Clipboard.setStringAsync(tempPassword)} />}>
          <View style={{ gap: 4 }}>
            <AppText variant="caption">{t('admin.tempPasswordBody')}</AppText>
            <AppText weight="extrabold" selectable style={{ fontSize: 18, writingDirection: 'ltr' }}>
              {ltr(tempPassword)}
            </AppText>
          </View>
        </Banner>
      ) : null}
      {adding ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="subheading">{t('admin.addUser')}</AppText>
          <Field label={t('fields.username')} required error={fields.username} hint={t('validation.username')}>
            <Input value={form.username} onChangeText={(username) => setForm({ ...form, username })} autoCapitalize="none" accessibilityLabel={t('fields.username')} ltrInput />
          </Field>
          <Field label={t('fields.fullName')} required error={fields.fullName}>
            <Input value={form.fullName} onChangeText={(fullName) => setForm({ ...form, fullName })} accessibilityLabel={t('fields.fullName')} />
          </Field>
          <Segmented
            label={t('fields.role')}
            value={form.role}
            onChange={(role) => setForm({ ...form, role })}
            options={[
              { value: 'security', label: t('roles.security') },
              { value: 'admin', label: t('roles.admin') },
            ]}
          />
          <AppText variant="small">{t('admin.passwordOptionalHint')}</AppText>
          <Button
            title={t('common.save')}
            loading={create.isPending}
            onPress={() => {
              const parsed = staffUserCreateSchema.safeParse(form);
              if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
              setFields({});
              create.mutate();
            }}
          />
          <Button title={t('common.cancel')} variant="secondary" onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <Button title={t('admin.addUser')} variant="accent" icon={<Plus size={18} color={colors.white} />} onPress={() => setAdding(true)} />
      )}
      {list.data?.items.map((u) => {
        const self = u.id === session?.user?.id;
        return (
          <Card key={u.id} style={{ gap: space.sm, padding: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <AppText weight="bold">{u.fullName}</AppText>
                <AppText variant="small">{ltr(`@${u.username}`)}</AppText>
              </View>
              {!self ? <Switch accessibilityLabel={t('common.active')} value={u.isActive} onValueChange={(isActive) => update.mutate({ id: u.id, body: { isActive } })} trackColor={{ true: colors.teal600 }} /> : null}
            </Row>
            <Row style={{ flexWrap: 'wrap' }}>
              <Badge tone={u.role === 'admin' ? 'navy' : 'teal'} label={t(`roles.${u.role}`)} />
              <Badge tone={u.isActive ? 'green' : 'neutral'} label={u.isActive ? t('common.active') : t('common.inactive')} />
              {u.mustChangePassword ? <Badge tone="amber" label={t('auth.changePasswordTitle')} /> : null}
            </Row>
            <AppText variant="small">{`${t('fields.lastLogin')}: ${fmt.dateTime(u.lastLoginAt)}`}</AppText>
            <Button
              title={t('admin.resetPassword')}
              variant="ghost"
              size="sm"
              icon={<KeyRound size={16} color={colors.navy800} />}
              onPress={() =>
                Alert.alert(t('admin.resetPassword'), u.fullName, [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('admin.resetPassword'), style: 'destructive', onPress: () => reset.mutate(u.id) },
                ])
              }
            />
          </Card>
        );
      })}
    </Screen>
  );
}
