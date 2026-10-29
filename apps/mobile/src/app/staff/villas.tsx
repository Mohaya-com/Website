import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Switch, View } from 'react-native';
import { fieldErrorsFromIssues, villaSchema, type Paginated, type VillaDTO } from '@vms/shared';
import { AppText, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Row } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { colors, ltr, space } from '@/lib/theme';

export default function Villas() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ number: '', label: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const list = useInfiniteQuery({
    queryKey: ['villas', 'mobile', q],
    queryFn: ({ pageParam }) => api<Paginated<VillaDTO>>(`/villas?page=${pageParam}&pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['villas'] });
    void qc.invalidateQueries({ queryKey: ['villa-options'] });
  };
  const create = useMutation({
    mutationFn: () => api<VillaDTO>('/villas', { body: { number: form.number, label: form.label || null, isActive: true } }),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setForm({ number: '', label: '' });
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });
  const toggle = useMutation({
    mutationFn: (v: VillaDTO) => api<VillaDTO>(`/villas/${v.id}`, { method: 'PATCH', body: { isActive: !v.isActive } }),
    onSuccess: invalidate,
    onError: (err) => Alert.alert(isApiError(err) ? t.dynamic(err.messageKey) : t('errors.internal_error')),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      style={{ backgroundColor: colors.canvas }}
      data={items}
      keyExtractor={(v) => v.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 40 }}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.sm }}>
          <Row>
            <Input value={draft} onChangeText={setDraft} placeholder={t('request.searchVilla')} accessibilityLabel={t('request.searchVilla')} onSubmitEditing={() => setQ(draft.trim())} style={{ flex: 1 }} />
            <Button title={t('common.search')} icon={<Search size={18} color={colors.white} />} onPress={() => setQ(draft.trim())} />
          </Row>
          {adding ? (
            <Card style={{ gap: space.md }}>
              <Field label={t('fields.villaNumber')} required error={fields.number}>
                <Input value={form.number} onChangeText={(number) => setForm({ ...form, number })} accessibilityLabel={t('fields.villaNumber')} ltrInput />
              </Field>
              <Field label={t('fields.villaLabel')}>
                <Input value={form.label} onChangeText={(label) => setForm({ ...form, label })} accessibilityLabel={t('fields.villaLabel')} />
              </Field>
              <Button
                title={t('common.save')}
                loading={create.isPending}
                onPress={() => {
                  const parsed = villaSchema.safeParse({ number: form.number, label: form.label || null, isActive: true });
                  if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
                  setFields({});
                  create.mutate();
                }}
              />
              <Button title={t('common.cancel')} variant="secondary" onPress={() => setAdding(false)} />
            </Card>
          ) : (
            <Button title={t('admin.addVilla')} variant="accent" icon={<Plus size={18} color={colors.white} />} onPress={() => setAdding(true)} />
          )}
        </View>
      }
      renderItem={({ item }) => (
        <Card style={{ padding: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <AppText weight="bold">{ltr(item.number)}</AppText>
              {item.label ? <AppText variant="small">{item.label}</AppText> : null}
            </View>
            <AppText variant="small">{item.isActive ? t('common.active') : t('common.inactive')}</AppText>
            <Switch accessibilityLabel={`${item.number} ${t('common.active')}`} value={item.isActive} onValueChange={() => toggle.mutate(item)} trackColor={{ true: colors.teal600 }} />
          </Row>
        </Card>
      )}
      onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && void list.fetchNextPage()}
      ListEmptyComponent={list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : <EmptyState title={t('common.noResults')} />}
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.teal600} /> : undefined}
    />
  );
}
