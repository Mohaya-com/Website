import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/server-session';
import { VisitorVerify } from './verify';

export default async function VisitorEntryPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getServerSession();
  const { next } = await searchParams;
  const target = next?.startsWith('/visitor/') ? next : '/visitor/home';
  if (session?.kind === 'visitor') redirect(target);
  if (session?.kind === 'registrant') redirect('/visitor/register');
  if (session?.kind === 'staff') redirect('/staff');
  return <VisitorVerify next={target} />;
}
