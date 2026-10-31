import { redirect } from 'next/navigation';

// The gate screen is the staff dashboard.
export default function GatePage() {
  redirect('/staff');
}
