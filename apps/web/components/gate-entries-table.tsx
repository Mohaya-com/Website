'use client';

import { ListChecks, Search, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QuickEntryDTO } from '@vms/shared';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { Badge, Card } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

const PAGE_SIZE = 25;

/** Every entry recorded at the gate (new visitors and resident invitations), newest first. */
export function GateEntriesTable() {
  const { t } = useI18n();
  const router = useRouter();
  const fmt = useFormat();
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['gate', 'history', q, page],
    queryFn: () => api<{ items: QuickEntryDTO[]; total: number }>(`/gate/entries?page=${page}&pageSize=${PAGE_SIZE}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: keepPreviousData,
  });
  return (
    <Card>
        <form
          className="relative border-b border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(draft.trim());
            setPage(1);
          }}
        >
          <Search className="pointer-events-none absolute start-7 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label={t('gate.search')} placeholder={t('gate.search')} className="ps-10" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
        {list.isLoading ? (
          <LoadingRows />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data?.items.length ? (
          <EmptyState icon={<ListChecks className="size-7" aria-hidden />} title={t('audit.empty')} />
        ) : (
          <>
            <DataTable
              caption={t('gate.entriesTab')}
              rows={list.data.items}
              rowKey={(e) => e.id}
              onRowClick={(e) => router.push(`/staff/entries/${e.id}`)}
              columns={[
                {
                  key: 'photo',
                  header: <span className="sr-only">{t('gate.photoCta')}</span>,
                  hideOnMobile: true,
                  cell: (e) =>
                    e.hasImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/v1/gate/entries/${e.id}/image`} alt="" loading="lazy" className="size-12 rounded-lg border border-line object-cover" />
                    ) : (
                      <span className="grid size-12 place-items-center rounded-lg bg-navy-50 text-navy-600">
                        <UserRound className="size-5" aria-hidden />
                      </span>
                    ),
                },
                {
                  key: 'who',
                  header: t('fields.visitor'),
                  cell: (e) => (
                    <div>
                      <p className="font-semibold text-ink">{e.fullName ?? t('gate.unnamed')}</p>
                      {e.documentNumber && (
                        <p className="text-xs text-muted ltr-nums">
                          {e.documentKind ? `${t(`gate.kinds.${e.documentKind}`)} · ` : ''}
                          {e.documentNumber}
                        </p>
                      )}
                    </div>
                  ),
                },
                { key: 'villa', header: t('fields.villa'), cell: (e) => <span className="font-semibold ltr-nums">{e.villaNumber}</span> },
                {
                  key: 'in',
                  header: t('gate.entryTab'),
                  cell: (e) => (
                    <div className="text-sm">
                      <p className="whitespace-nowrap">{fmt.dateTime(e.enteredAt)}</p>
                      {e.enteredBy && <p className="text-xs text-muted">{e.enteredBy}</p>}
                    </div>
                  ),
                },
                {
                  key: 'out',
                  header: t('gate.exitTab'),
                  cell: (e) => (e.exitedAt ? <span className="whitespace-nowrap text-sm">{fmt.dateTime(e.exitedAt)}</span> : <Badge tone="teal">{t('gate.stillInside')}</Badge>),
                },
                {
                  key: 'owner',
                  header: <span className="sr-only">{t('gate.ownerPending')}</span>,
                  hideOnMobile: true,
                  cell: (e) =>
                    e.ownerResponse === 'confirmed' ? <Badge tone="green">{t('gate.ownerConfirmed')}</Badge> : e.ownerResponse === 'declined' ? <Badge tone="red">{t('gate.ownerDeclined')}</Badge> : null,
                },
              ]}
            />
            <Pagination page={page} totalPages={Math.max(1, Math.ceil(list.data.total / PAGE_SIZE))} total={list.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
    </Card>
  );
}
