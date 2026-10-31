/**
 * In the Node.js server process: loads the ID photo reader in the background (so the first read after a
 * restart is quick) and starts the lifecycle sweeper (pass expiry, stale requests, overdue flags).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { getServerContext, startMaintenanceLoop, warmUpIdReader } = await import('@vms/server');
  if (process.env.VMS_DISABLE_OCR_WARMUP !== 'true') warmUpIdReader();
  if (process.env.VMS_DISABLE_MAINTENANCE === 'true') return;
  try {
    startMaintenanceLoop(getServerContext());
  } catch (err) {
    console.error('[vms] maintenance loop not started:', (err as Error).message);
  }
}
