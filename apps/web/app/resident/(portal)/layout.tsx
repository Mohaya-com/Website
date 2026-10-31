import { ResidentShell } from '@/components/shell/resident-shell';
import { requireResidentSession } from '@/lib/server-session';

export default async function ResidentPortalLayout({ children }: { children: React.ReactNode }) {
  await requireResidentSession();
  return <ResidentShell>{children}</ResidentShell>;
}
