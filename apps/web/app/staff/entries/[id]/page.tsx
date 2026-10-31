'use client';

import { ArrowRight, CalendarClock, DoorOpen, IdCard, LogIn, LogOut, Phone, UserRound } from 'lucide-react';
import { use, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GateVillaDTO, QuickEntryCreatedDTO, VisitorRecordDTO } from '@vms/shared';
import { ErrorState, LoadingRows } from '@/components/ui/feedback';
import { Badge, ButtonLink, Card, CardHeader, PageHeader } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

const STATUS_TONE = { expected: 'amber', inside: 'teal', exited: 'slate', cancelled: 'red' } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-end font-semibold text-ink">{children}</dd>
    </div>
  );
}

function StatusLabel({ entry }: { entry: VisitorRecordDTO }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[entry.status]}>{t(`entryDetails.status.${entry.status}`)}</Badge>;
}

/** Everything about one gate entry or resident's visit request: the visitor, the ID photo and the visit. */
export default function EntryDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['gate', 'entry', id], queryFn: () => api<QuickEntryCreatedDTO>(`/gate/entries/${id}`) });
  const e = q.data?.entry;
  const villa = useQuery({
    queryKey: ['gate', 'villa', e?.villaNumber],
    queryFn: () => api<GateVillaDTO>(`/gate/villa?number=${encodeURIComponent(e!.villaNumber)}`),
    enabled: !!e,
    retry: false,
  });
  const owner = villa.data?.villa;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('entryDetails.title')}
        actions={
          <ButtonLink href="/staff" variant="ghost" icon={<ArrowRight className="size-4 ltr:rotate-180" aria-hidden />}>
            {t('nav.dashboard')}
          </ButtonLink>
        }
      />
      {q.isLoading ? (
        <LoadingRows rows={5} />
      ) : q.isError || !e ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title={t('entryDetails.visitor')} icon={<UserRound className="size-5" aria-hidden />} actions={<StatusLabel entry={e} />} />
            {e.hasImage ? (
              <a href={`/api/v1/gate/entries/${e.id}/image`} target="_blank" rel="noopener noreferrer" className="block border-b border-line bg-navy-50 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/v1/gate/entries/${e.id}/image`} alt={t('entryDetails.idPhoto')} className="mx-auto max-h-72 w-full rounded-xl object-contain" />
              </a>
            ) : (
              <p className="flex items-center gap-2 border-b border-line px-5 py-4 text-sm text-muted">
                <IdCard className="size-4" aria-hidden />
                {t('entryDetails.noPhoto')}
              </p>
            )}
            <dl>
              <Row label={t('gate.fullName')}>{e.fullName ?? '—'}</Row>
              <Row label={t('gate.documentNumber')}>
                <span className="ltr-nums" dir="ltr">
                  {e.documentNumber ?? '—'}
                </span>
                {e.documentKind && <span className="ms-2 text-sm font-normal text-muted">{t(`gate.kinds.${e.documentKind}`)}</span>}
              </Row>
              {e.visitorMobile && (
                <Row label={t('resident.visitorMobile')}>
                  <a href={`tel:${e.visitorMobile}`} className="ltr-nums text-teal-700" dir="ltr">
                    {e.visitorMobile}
                  </a>
                </Row>
              )}
            </dl>
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title={t('entryDetails.visit')} icon={<DoorOpen className="size-5" aria-hidden />} />
              <dl>
                <Row label={t('fields.villa')}>
                  <span className="ltr-nums">{e.villaNumber}</span>
                </Row>
                <Row label={t('gate.villaOwner')}>{owner?.ownerName ?? '—'}</Row>
                {owner?.ownerMobile && (
                  <Row label={t('entryDetails.ownerPhone')}>
                    <a href={`tel:${owner.ownerMobile}`} className="inline-flex items-center gap-1.5 text-teal-700" dir="ltr">
                      <Phone className="size-4" aria-hidden />
                      <span className="ltr-nums">{owner.ownerMobile.startsWith('+966') ? `0${owner.ownerMobile.slice(4)}` : owner.ownerMobile}</span>
                    </a>
                  </Row>
                )}
                <Row label={t('entryDetails.source')}>{e.invitedByResident ? t('entryDetails.byResident') : t('entryDetails.byGate')}</Row>
                {e.ownerResponse && <Row label={t('entryDetails.ownerResponse')}>{e.ownerResponse === 'confirmed' ? t('gate.ownerConfirmed') : t('gate.ownerDeclined')}</Row>}
              </dl>
            </Card>
            <Card>
              <CardHeader title={t('entryDetails.timeline')} icon={<CalendarClock className="size-5" aria-hidden />} />
              <dl>
                {e.expectedAt && <Row label={t('entryDetails.expected')}>{fmt.dateTime(e.expectedAt)}</Row>}
                <Row label={t('entryDetails.entered')}>
                  {e.enteredAt ? (
                    <span className="inline-flex items-center gap-1.5">
                      <LogIn className="size-4 text-emerald-700 rtl:-scale-x-100" aria-hidden />
                      {fmt.dateTime(e.enteredAt)}
                    </span>
                  ) : (
                    t('entryDetails.notYet')
                  )}
                  {e.enteredBy && <span className="block text-sm font-normal text-muted">{t('entryDetails.by', { name: e.enteredBy })}</span>}
                </Row>
                <Row label={t('entryDetails.exited')}>
                  {e.exitedAt ? (
                    <span className="inline-flex items-center gap-1.5">
                      <LogOut className="size-4 text-slate-600 rtl:-scale-x-100" aria-hidden />
                      {fmt.dateTime(e.exitedAt)}
                    </span>
                  ) : (
                    '—'
                  )}
                  {e.exitedBy && <span className="block text-sm font-normal text-muted">{t('entryDetails.by', { name: e.exitedBy })}</span>}
                </Row>
                {e.gate && <Row label={t('gate.gateLabel')}>{locale === 'ar' ? e.gate.nameAr : e.gate.nameEn}</Row>}
              </dl>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
