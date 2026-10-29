import { notFound } from 'next/navigation';
import { DevOtpView } from './view';

/** DEVELOPMENT ONLY — never available in production builds. */
export default function DevOtpPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DevOtpView />;
}
