'use client';

import { NotificationsList } from '@/components/notifications-list';
import { useSession } from '@/lib/hooks';

export default function StaffNotificationsPage() {
  const { data: session } = useSession();
  const admin = session?.role === 'admin';
  return <NotificationsList hrefFor={(n) => (!n.visitId ? null : n.type === 'visit_submitted' && admin ? `/staff/requests/${n.visitId}` : `/staff/visits/${n.visitId}`)} />;
}
