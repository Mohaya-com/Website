'use client';

import { Eye, FileText, Lock, MessageSquareText, Timer, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { PublicShell } from '@/components/shell/public-shell';
import { Card } from '@/components/ui/primitives';
import { useI18n } from '@/lib/i18n';

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">{icon}</span>
      <div>
        <h2 className="font-bold text-navy-900">{title}</h2>
        <p className="mt-1 text-[15px] leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

/** Concise privacy notice: why visitor information is collected and how it is used. */
export default function PrivacyPage() {
  const { t } = useI18n();
  return (
    <PublicShell wide>
      <Card className="p-6 sm:p-8 animate-slide-up">
        <h1 className="flex items-center gap-3 text-2xl font-extrabold text-navy-900">
          <Lock className="size-7 text-teal-600" aria-hidden />
          {t('privacy.title')}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink">{t('privacy.intro')}</p>
        <div className="mt-6 space-y-6">
          <Section icon={<FileText className="size-5" aria-hidden />} title={t('privacy.whatTitle')}>
            {t('privacy.what')}
          </Section>
          <Section icon={<Eye className="size-5" aria-hidden />} title={t('privacy.whyTitle')}>
            {t('privacy.why')}
          </Section>
          <Section icon={<Users className="size-5" aria-hidden />} title={t('privacy.whoTitle')}>
            {t('privacy.who')}
          </Section>
          <Section icon={<MessageSquareText className="size-5" aria-hidden />} title={t('privacy.smsTitle')}>
            {t('privacy.sms')}
          </Section>
          <Section icon={<Timer className="size-5" aria-hidden />} title={t('privacy.retentionTitle')}>
            {t('privacy.retention')}
          </Section>
        </div>
      </Card>
    </PublicShell>
  );
}
