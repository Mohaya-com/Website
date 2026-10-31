'use client';

import { BellRing, Check, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VisitorRecordDTO } from '@vms/shared';
import { VisitorRecordCard } from '@/components/visitor-record';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Button, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** Visitors the gate recorded for the villa, waiting for the resident to confirm. */
export default function ConfirmationsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['resident', 'confirmations'], queryFn: () => api<{ items: VisitorRecordDTO[] }>('/resident/confirmations'), refetchInterval: 30_000 });
  const respond = useMutation({
    mutationFn: ({ id, response }: { id: string; response: 'confirmed' | 'declined' }) => api(`/resident/entries/${id}/respond`, { body: { response } }),
    onSuccess: (_r, v) => {
      toast(v.response === 'confirmed' ? t('resident.confirmedToast') : t('resident.declinedToast'));
      void qc.invalidateQueries({ queryKey: ['resident'] });
    },
  });
  return (
    <div>
      <PageHeader title={t('resident.confirmationsTitle')} subtitle={t('resident.confirmationsSubtitle')} />
      {q.isLoading ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<BellRing className="size-7" aria-hidden />} title={t('resident.noConfirmations')} />
      ) : (
        <ul className="space-y-3">
          {q.data.items.map((r) => (
            <li key={r.id}>
              <VisitorRecordCard
                record={r}
                actions={
                  <>
                    <Button size="sm" variant="danger" icon={<X className="size-4" aria-hidden />} loading={respond.isPending && respond.variables?.id === r.id && respond.variables.response === 'declined'} onClick={() => respond.mutate({ id: r.id, response: 'declined' })}>
                      {t('resident.decline')}
                    </Button>
                    <Button size="sm" variant="success" icon={<Check className="size-4" aria-hidden />} loading={respond.isPending && respond.variables?.id === r.id && respond.variables.response === 'confirmed'} onClick={() => respond.mutate({ id: r.id, response: 'confirmed' })}>
                      {t('resident.confirm')}
                    </Button>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
