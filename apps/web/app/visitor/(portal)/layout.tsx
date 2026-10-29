import { VisitorShell } from '@/components/shell/visitor-shell';
import { requireVisitorSession } from '@/lib/server-session';

export default async function VisitorPortalLayout({ children }: { children: React.ReactNode }) {
  await requireVisitorSession();
  return <VisitorShell>{children}</VisitorShell>;
}
