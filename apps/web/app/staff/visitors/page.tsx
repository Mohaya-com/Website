'use client';

import { Search, UserRoundSearch } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { sortedCountries, type Paginated, type VisitorSummaryDTO } from '@vms/shared';
import { DocumentStatusBadge } from '@/components/status';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { Button, Card, PageHeader } from '@/components/ui/primitives';
import { DataTable, Pagination } from '@/components/ui/table';
import { useVisitLabels } from '@/components/visit-views';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

/** Administrator search across visitor profiles (identity numbers are masked in the list). */
export default function VisitorsPage() {
  const { t, locale } = useI18n();
  const fmt = useFormat();
  const labels = useVisitLabels();
  const router = useRouter();
  const countries = useMemo(() => sortedCountries(locale), [locale]);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [nationality, setNationality] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '20', ...(q ? { q } : {}), ...(nationality ? { nationality } : {}) }).toString();
  const list = useQuery({ queryKey: ['visitors', params], queryFn: () => api<Paginated<VisitorSummaryDTO>>(`/visitors?${params}`), placeholderData: keepPreviousData });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(draft.trim());
    setPage(1);
  };
  return (
    <div>
      <PageHeader title={t('admin.visitorsTitle')} subtitle={t('admin.visitorsSubtitle')} />
      <Card>
        <form role="search" onSubmit={submit} className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-5 text-muted" aria-hidden />
            <Input aria-label={t('common.search')} className="ps-10" placeholder={t('admin.visitorsSearchPlaceholder')} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <Select aria-label={t('fields.nationality')} className="sm:w-56" value={nationality} onChange={(e) => {
            setNationality(e.target.value);
            setPage(1);
          }}>
            <option value="">{`${t('fields.nationality')}: ${t('common.all')}`}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c[locale]}
              </option>
            ))}
          </Select>
          <Button type="submit" icon={<Search className="size-4" aria-hidden />}>
            {t('common.search')}
          </Button>
        </form>
        {list.isLoading ? (
          <LoadingRows />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data?.items.length ? (
          <EmptyState icon={<UserRoundSearch className="size-7" aria-hidden />} title={t('common.noResults')} hint={t('common.noResultsHint')} />
        ) : (
          <>
            <DataTable
              caption={t('admin.visitorsTitle')}
              rows={list.data.items}
              rowKey={(v) => v.id}
              onRowClick={(v) => router.push(`/staff/visitors/${v.id}`)}
              columns={[
                { key: 'name', header: t('fields.fullName'), cell: (v) => <span className="font-semibold">{v.fullName}</span> },
                {
                  key: 'doc',
                  header: t('fields.documentNumber'),
                  cell: (v) => (
                    <div>
                      <p className="font-semibold ltr-nums">{v.documentNumberMasked}</p>
                      <p className="text-xs text-muted">{t(`documentTypes.${v.documentType}`)}</p>
                    </div>
                  ),
                },
                { key: 'nat', header: t('fields.nationality'), cell: (v) => labels.nationality(v.nationality), hideOnMobile: true },
                { key: 'mobile', header: t('fields.mobile'), cell: (v) => <span className="ltr-nums">{v.mobileMasked}</span>, hideOnMobile: true },
                { key: 'expiry', header: t('fields.documentExpiry'), cell: (v) => <DocumentStatusBadge expired={v.documentExpired} label={fmt.ymd(v.documentExpiryDate)} /> },
                { key: 'count', header: t('fields.visitsCount'), cell: (v) => <span className="font-bold ltr-nums">{v.visitCount}</span> },
                { key: 'last', header: t('fields.lastVisit'), cell: (v) => (v.lastVisitAt ? fmt.date(v.lastVisitAt) : '—'), hideOnMobile: true },
              ]}
            />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
