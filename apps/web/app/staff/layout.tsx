import { StaffShell } from '@/components/shell/staff-shell';
import { requireStaffSession } from '@/lib/server-session';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaffSession();
  return <StaffShell initialSession={session}>{children}</StaffShell>;
}
