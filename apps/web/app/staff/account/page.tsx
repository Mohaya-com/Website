'use client';

import { KeyRound, Languages, LogOut, UserRound } from 'lucide-react';
import { ChangePasswordForm } from '@/components/change-password-form';
import { Segmented } from '@/components/ui/form';
import { Button, Card, CardHeader, DetailItem, PageHeader } from '@/components/ui/primitives';
import { useFormat, useLogout, useSession } from '@/lib/hooks';
import { useI18n } from '@/lib/i18n';

export default function StaffAccountPage() {
  const { t, locale, setLocale } = useI18n();
  const fmt = useFormat();
  const logout = useLogout();
  const { data: session } = useSession();
  const user = session?.user;
  return (
    <div className="space-y-6">
      <PageHeader title={t('account.title')} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('account.profile')} icon={<UserRound className="size-5" aria-hidden />} />
          <dl className="grid grid-cols-2 gap-4 p-5">
            <DetailItem className="col-span-2" label={t('fields.fullName')} value={user?.fullName} />
            <DetailItem label={t('fields.username')} value={<span dir="ltr">{user?.username}</span>} />
            <DetailItem label={t('fields.role')} value={session ? t(`roles.${session.role}`) : '—'} />
            <DetailItem label={t('fields.lastLogin')} value={fmt.dateTime(user?.lastLoginAt)} />
          </dl>
        </Card>
        <Card>
          <CardHeader title={t('account.language')} subtitle={t('account.languageHint')} icon={<Languages className="size-5" aria-hidden />} />
          <div className="p-5">
            <Segmented
              label={t('account.language')}
              size="lg"
              value={locale}
              onChange={setLocale}
              options={[
                { value: 'ar', label: 'العربية' },
                { value: 'en', label: 'English' },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title={t('auth.changePasswordTitle')} icon={<KeyRound className="size-5" aria-hidden />} />
          <div className="p-5">
            <ChangePasswordForm onDone={() => undefined} />
          </div>
        </Card>
      </div>
      <Button variant="secondary" size="lg" icon={<LogOut className="size-5 rtl:-scale-x-100" aria-hidden />} onClick={() => void logout()}>
        {t('common.logout')}
      </Button>
    </div>
  );
}
