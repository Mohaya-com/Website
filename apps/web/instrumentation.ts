/** Starts the lifecycle sweeper (pass expiry, stale requests, overdue flags) in the Node.js server process. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.VMS_DISABLE_MAINTENANCE === 'true' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { getServerContext, startMaintenanceLoop } = await import('@vms/server');
  try {
    startMaintenanceLoop(getServerContext());
  } catch (err) {
    console.error('[vms] maintenance loop not started:', (err as Error).message);
  }
}
