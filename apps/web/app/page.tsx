import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/server-session';
import { Landing } from './landing';

export default async function HomePage() {
  const session = await getServerSession();
  if (session?.kind === 'staff') redirect(session.user?.mustChangePassword ? '/change-password' : '/staff');
  if (session?.kind === 'visitor') redirect('/visitor/home');
  if (session?.kind === 'registrant') redirect('/visitor/register');
  return <Landing />;
}
