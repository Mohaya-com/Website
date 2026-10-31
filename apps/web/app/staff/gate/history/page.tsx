import { redirect } from 'next/navigation';

// Gate entries are part of the visit log now.
export default function GateHistoryPage() {
  redirect('/staff/visits');
}
