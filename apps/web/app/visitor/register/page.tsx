import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/server-session';
import { RegisterForm } from './form';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getServerSession();
  const { next } = await searchParams;
  if (!session) redirect('/visitor');
  if (session.kind === 'visitor') redirect('/visitor/home');
  if (session.kind === 'staff') redirect('/staff');
  return <RegisterForm session={session} next={next?.startsWith('/visitor/') ? next : '/visitor/home'} />;
}
