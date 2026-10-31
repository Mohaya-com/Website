'use client';

import { MessageCircle, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteCreatedDTO, VisitorRecordDTO } from '@vms/shared';
import { VisitorRecordCard } from '@/components/visitor-record';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { Button, ButtonLink, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

type Tab = 'upcoming' | 'inside' | 'past';

/** The villa's visitors: upcoming invitations, visitors inside now, and past visits. */
export default function ResidentVisitorsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>('upcoming');
  const q = useQuery({
    queryKey: ['resident', 'visitors'],
    queryFn: () => api<{ upcoming: VisitorRecordDTO[]; inside: VisitorRecordDTO[]; past: VisitorRecordDTO[] }>('/resident/visitors'),
    refetchInterval: 30_000,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/resident/invites/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['resident'] }),
  });
  async function share(id: string) {
    const res = await api<InviteCreatedDTO>(`/resident/invites/${id}`);
    if (res.whatsappUrl) window.open(res.whatsappUrl, '_blank', 'noopener');
    else await navigator.clipboard?.writeText(res.inviteLink).then(() => toast(t('common.copied'), 'info'));
  }

  const items = q.data?.[tab] ?? [];
  return (
    <div>
      <PageHeader
        title={t('resident.nav.visitors')}
        subtitle={session?.resident ? t('resident.villaHeader', { villa: session.resident.villaNumber }) : undefined}
        actions={
          <ButtonLink href="/resident/invite" variant="accent">
            {t('resident.nav.invite')}
          </ButtonLink>
        }
      />
      <div className="mb-4">
        <Segmented
          label={t('resident.nav.visitors')}
          value={tab}
          onChange={setTab}
          options={(['upcoming', 'inside', 'past'] as const).map((k) => ({ value: k, label: `${t(`resident.tabs.${k}`)}${q.data?.[k].length ? ` (${q.data[k].length})` : ''}` }))}
        />
      </div>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !items.length ? (
        <EmptyState icon={<Users className="size-7" aria-hidden />} title={t('resident.empty')} />
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id}>
              <VisitorRecordCard
                record={r}
                actions={
                  r.status === 'expected' ? (
                    <>
                      <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden />} loading={cancel.isPending && cancel.variables === r.id} onClick={() => cancel.mutate(r.id)}>
                        {t('resident.cancelInvite')}
                      </Button>
                      <Button size="sm" variant="secondary" icon={<MessageCircle className="size-4" aria-hidden />} onClick={() => void share(r.id)}>
                        {t('resident.shareInvite')}
                      </Button>
                    </>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
