import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionFromToken, sessionCookieName } from '@vms/server';
import type { SessionInfoDTO } from '@vms/shared';

/** Reads the HttpOnly session cookie on the server and resolves it with the shared backend. */
export async function getServerSession(): Promise<SessionInfoDTO | null> {
  const store = await cookies();
  return getSessionFromToken(store.get(sessionCookieName())?.value);
}

export async function requireStaffSession(): Promise<SessionInfoDTO> {
  const session = await getServerSession();
  if (!session || session.kind !== 'staff') redirect('/login');
  if (session.user?.mustChangePassword) redirect('/change-password');
  return session;
}

export async function requireVisitorSession(): Promise<SessionInfoDTO> {
  const session = await getServerSession();
  if (!session) redirect('/visitor');
  if (session.kind === 'registrant') redirect('/visitor/register');
  if (session.kind === 'staff') redirect('/staff');
  return session;
}
