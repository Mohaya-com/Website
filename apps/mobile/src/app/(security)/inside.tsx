import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Screen, ScreenTitle } from '@/components/ui';
import { InsideList } from '@/features/staff';
import { useI18n } from '@/lib/i18n';

export default function SecurityInside() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void qc.invalidateQueries({ queryKey: ['inside'] }).finally(() => setRefreshing(false));
      }}
    >
      <ScreenTitle title={t('admin.insideTitle')} />
      <InsideList />
    </Screen>
  );
}
