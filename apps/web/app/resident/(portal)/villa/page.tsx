'use client';

import { Home, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldErrorsFromIssues, villaContactSchema } from '@vms/shared';
import { Banner, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Button, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, isApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type VillaContact = { villaNumber: string; ownerName: string | null; ownerMobile: string | null };

const localMobile = (m: string | null) => (m?.startsWith('+966') ? `0${m.slice(4)}` : (m ?? ''));

/** The only villa details a resident can change: the contact name and phone shown to gate security. */
export default function VillaPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['resident', 'villa'], queryFn: () => api<VillaContact>('/resident/villa') });
  const [ownerName, setOwnerName] = useState('');
  const [ownerMobile, setOwnerMobile] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) {
      setOwnerName(q.data.ownerName ?? '');
      setOwnerMobile(localMobile(q.data.ownerMobile));
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: unknown) => api<VillaContact>('/resident/villa', { method: 'PUT', body }),
    onSuccess: (d) => {
      qc.setQueryData(['resident', 'villa'], d);
      toast(t('resident.saved'));
    },
    onError: (err) => isApiError(err) && setFields(err.fields),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t('resident.villaTitle')} subtitle={t('resident.villaSubtitle')} />
      <Card>
        <CardHeader title={t('resident.villaHeader', { villa: q.data.villaNumber })} icon={<Home className="size-5" aria-hidden />} />
        <div className="space-y-4 p-5">
          <Field label={t('resident.fullName')} error={fields.ownerName}>
            {(a) => <Input {...a} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />}
          </Field>
          <Field label={t('resident.mobile')} error={fields.ownerMobile}>
            {(a) => <Input {...a} type="tel" inputMode="tel" dir="ltr" placeholder="05X XXX XXXX" className="ltr-nums" value={ownerMobile} onChange={(e) => setOwnerMobile(e.target.value)} />}
          </Field>
          {save.isError && !Object.keys(fields).length && <Banner tone="danger">{isApiError(save.error) ? t.dynamic(save.error.messageKey) : t('errors.internal_error')}</Banner>}
          <div className="flex justify-end">
            <Button
              variant="accent"
              loading={save.isPending}
              icon={<Save className="size-4" aria-hidden />}
              onClick={() => {
                const body = { ownerName, ownerMobile: ownerMobile || null };
                const parsed = villaContactSchema.safeParse(body);
                if (!parsed.success) return setFields(fieldErrorsFromIssues(parsed.error.issues));
                setFields({});
                save.mutate(body);
              }}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
