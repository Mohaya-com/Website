import { Redirect } from 'expo-router';
import { homeFor, useSession } from '@/lib/session';

/** Entry point: route to the home of the signed-in role, or the welcome screen. */
export default function Index() {
  const { session } = useSession();
  return <Redirect href={homeFor(session) as never} />;
}
