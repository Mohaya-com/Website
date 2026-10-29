'use client';

import { NotificationsList } from '@/components/notifications-list';

export default function VisitorNotificationsPage() {
  return <NotificationsList hrefFor={(n) => (n.visitId ? `/visitor/visits/${n.visitId}` : null)} />;
}
