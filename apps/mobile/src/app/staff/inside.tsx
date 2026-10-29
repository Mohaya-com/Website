import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Screen } from '@/components/ui';
import { InsideList } from '@/features/staff';

export default function StaffInside() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Screen
      edges={['bottom']}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void qc.invalidateQueries({ queryKey: ['inside'] }).finally(() => setRefreshing(false));
      }}
    >
      <InsideList />
    </Screen>
  );
}
