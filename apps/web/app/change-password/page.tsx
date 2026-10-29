'use client';

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChangePasswordForm } from '@/components/change-password-form';
import { PublicShell } from '@/components/shell/public-shell';
import { Banner } from '@/components/ui/feedback';
import { Card } from '@/components/ui/primitives';
import { useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

export default function ChangePasswordPage() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session } = useSession();
  return (
    <PublicShell>
      <Card className="p-6 sm:p-8 animate-slide-up">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-navy-900 text-white">
            <KeyRound className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-extrabold text-navy-900">{t('auth.changePasswordTitle')}</h1>
        </div>
        {session?.user?.mustChangePassword && (
          <Banner tone="warning" className="mb-4">
            {t('auth.changePasswordRequired')}
          </Banner>
        )}
        <ChangePasswordForm
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['session'] });
            router.replace('/staff');
          }}
        />
      </Card>
    </PublicShell>
  );
}
