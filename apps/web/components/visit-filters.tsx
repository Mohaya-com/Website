'use client';

import { Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, type FormEvent } from 'react';
import { VISIT_STATUSES, sortedCountries, type GateDTO } from '@vms/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useVillaOptions } from './inputs';
import { Input, Select } from './ui/form';
import { Button } from './ui/primitives';

export interface VisitFilterState {
  q: string;
  status: string;
  villaId: string;
  gateId: string;
  nationality: string;
  from: string;
  to: string;
  sort: string;
}

export const EMPTY_FILTERS: VisitFilterState = { q: '', status: '', villaId: '', gateId: '', nationality: '', from: '', to: '', sort: 'newest' };

export function filtersToQuery(f: VisitFilterState, page: number, pageSize = 20): string {
  const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort: f.sort });
  for (const k of ['q', 'status', 'villaId', 'gateId', 'nationality', 'from', 'to'] as const) if (f[k]) p.set(k, f[k]);
  return p.toString();
}

export function useGates(all = false) {
  return useQuery({ queryKey: ['gates', all], queryFn: () => api<{ items: GateDTO[] }>(`/gates${all ? '?all=true' : ''}`), staleTime: 60_000 });
}

/** Search box + filters for visit history (date range, villa, status, gate, nationality). */
export function VisitFilters({ value, draft, onDraft, onApply, hideStatus }: { value: VisitFilterState; draft: VisitFilterState; onDraft: (f: VisitFilterState) => void; onApply: (f: VisitFilterState) => void; hideStatus?: boolean }) {
  const { t, locale } = useI18n();
  const villas = useVillaOptions();
  const gates = useGates(true);
  const countries = useMemo(() => sortedCountries(locale), [locale]);
  const active = Object.entries(value).some(([k, v]) => k !== 'sort' && v);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(draft);
  };
  return (
    <form onSubmit={submit} className="space-y-3 border-b border-line p-4" role="search">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-5 text-muted" aria-hidden />
          <Input aria-label={t('common.search')} placeholder={t('admin.visitorsSearchPlaceholder')} className="ps-10" value={draft.q} onChange={(e) => onDraft({ ...draft, q: e.target.value })} />
        </div>
        <Button type="submit" icon={<Search className="size-4" aria-hidden />}>
          {t('common.search')}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {!hideStatus && (
          <Select aria-label={t('fields.status')} value={draft.status} onChange={(e) => onApply({ ...draft, status: e.target.value })}>
            <option value="">{`${t('fields.status')}: ${t('common.all')}`}</option>
            {VISIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label={t('fields.villa')} value={draft.villaId} onChange={(e) => onApply({ ...draft, villaId: e.target.value })}>
          <option value="">{`${t('fields.villa')}: ${t('common.all')}`}</option>
          {villas.data?.items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.number}
            </option>
          ))}
        </Select>
        <Select aria-label={t('fields.gate')} value={draft.gateId} onChange={(e) => onApply({ ...draft, gateId: e.target.value })}>
          <option value="">{`${t('fields.gate')}: ${t('common.all')}`}</option>
          {gates.data?.items.map((g) => (
            <option key={g.id} value={g.id}>
              {locale === 'ar' ? g.nameAr : g.nameEn}
            </option>
          ))}
        </Select>
        <Select aria-label={t('fields.nationality')} value={draft.nationality} onChange={(e) => onApply({ ...draft, nationality: e.target.value })}>
          <option value="">{`${t('fields.nationality')}: ${t('common.all')}`}</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c[locale]}
            </option>
          ))}
        </Select>
        <label className="flex flex-col">
          <span className="sr-only">{t('fields.dateFrom')}</span>
          <Input type="date" aria-label={t('fields.dateFrom')} value={draft.from} onChange={(e) => onApply({ ...draft, from: e.target.value })} />
        </label>
        <label className="flex flex-col">
          <span className="sr-only">{t('fields.dateTo')}</span>
          <Input type="date" aria-label={t('fields.dateTo')} value={draft.to} min={draft.from || undefined} onChange={(e) => onApply({ ...draft, to: e.target.value })} />
        </label>
        <Select aria-label={t('common.sortBy')} value={draft.sort} onChange={(e) => onApply({ ...draft, sort: e.target.value })}>
          <option value="newest">{t('common.newest')}</option>
          <option value="oldest">{t('common.oldest')}</option>
          <option value="entry_asc">{t('common.entrySoonest')}</option>
          <option value="entry_desc">{t('common.entryLatest')}</option>
        </Select>
      </div>
      {active && (
        <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={() => onApply({ ...EMPTY_FILTERS })}>
          {t('common.clearFilters')}
        </Button>
      )}
    </form>
  );
}
