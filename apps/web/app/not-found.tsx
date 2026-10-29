'use client';

import { Compass } from 'lucide-react';
import { PublicShell } from '@/components/shell/public-shell';
import { EmptyState } from '@/components/ui/feedback';
import { ButtonLink, Card } from '@/components/ui/primitives';
import { useI18n } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <PublicShell>
      <Card>
        <EmptyState
          icon={<Compass className="size-7" aria-hidden />}
          title={t('errors.notFoundPage')}
          hint={t('errors.notFoundPageHint')}
          action={
            <ButtonLink href="/" variant="secondary">
              {t('common.goHome')}
            </ButtonLink>
          }
        />
      </Card>
    </PublicShell>
  );
}
