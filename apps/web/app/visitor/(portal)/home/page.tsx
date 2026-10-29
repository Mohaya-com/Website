'use client';

import { CalendarPlus, QrCode, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { Paginated, VisitDTO } from '@vms/shared';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { ButtonLink, Card } from '@/components/ui/primitives';
import { VisitProgress, VisitSummaryCard } from '@/components/visit-views';
import { api } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

const OPEN = new Set(['pending', 'approved', 'checked_in']);

export default function VisitorHomePage() {
  const { t } = useI18n();
  const { data: session } = useSession();
  const visits = useQuery({ queryKey: ['my-visits', 1], queryFn: () => api<Paginated<VisitDTO>>('/me/visits?page=1&pageSize=10') });
  const open = (visits.data?.items ?? []).filter((v) => OPEN.has(v.status)).sort((a, b) => a.requestedEntryAt.localeCompare(b.requestedEntryAt));
  const current = open.find((v) => v.status === 'checked_in') ?? open[0];
  const recent = (visits.data?.items ?? []).filter((v) => v.id !== current?.id).slice(0, 3);
  const visitor = session?.visitor;

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-extrabold text-navy-900">{t('visitor.homeGreeting', { name: visitor?.fullName.split(' ')[0] ?? '' })}</h1>
        <p className="text-[15px] text-muted">{t('visitor.homeSubtitle')}</p>
      </div>

      {visitor?.documentExpired && (
        <Banner tone="danger" icon={<ShieldAlert className="size-5" aria-hidden />} action={<Link href="/visitor/account" className="whitespace-nowrap font-bold underline">{t('visitor.updateExpiry')}</Link>}>
          {t('visitor.documentExpiredWarning')}
        </Banner>
      )}

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-l from-navy-900 to-navy-700 px-5 py-4 text-white">
          <p className="text-sm font-semibold text-navy-100">{t('visitor.activeVisit')}</p>
        </div>
        {visits.isLoading ? (
          <LoadingRows rows={2} />
        ) : visits.isError ? (
          <ErrorState error={visits.error} onRetry={() => void visits.refetch()} />
        ) : current ? (
          <div className="space-y-5 p-5">
            <VisitSummaryCard visit={current} href={`/visitor/visits/${current.id}`} />
            <VisitProgress visit={current} />
            {(current.status === 'approved' || current.status === 'checked_in') && (
              <ButtonLink href={`/visitor/visits/${current.id}#pass`} size="lg" variant="accent" block icon={<QrCode className="size-5" aria-hidden />}>
                {t('visitor.viewPass')}
              </ButtonLink>
            )}
          </div>
        ) : (
          <EmptyState title={t('visitor.noActiveVisit')} hint={t('visitor.noActiveVisitHint')} />
        )}
      </Card>

      <ButtonLink href="/visitor/request" size="lg" block icon={<CalendarPlus className="size-5" aria-hidden />}>
        {t('visitor.newRequest')}
      </ButtonLink>

      {recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-navy-900">{t('visitor.myVisits')}</h2>
            <Link href="/visitor/visits" className="text-sm font-semibold text-teal-700 hover:underline">
              {t('common.showAll')}
            </Link>
          </div>
          <div className="space-y-3">
            {recent.map((v) => (
              <VisitSummaryCard key={v.id} visit={v} href={`/visitor/visits/${v.id}`} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
