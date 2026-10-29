/** Runs the lifecycle sweep once (for cron-based deployments):  pnpm maintenance */
import { loadRootEnv } from '../config';
import { createServerContext } from '../context';
import { runMaintenance } from '../services/maintenance';

loadRootEnv();
const ctx = createServerContext();
runMaintenance(ctx)
  .then((r) => console.log(`✔ Maintenance complete: ${r.autoCancelled} auto-cancelled, ${r.expired} expired, ${r.overdueFlagged} flagged overdue`))
  .catch((err: Error) => {
    console.error(`✘ Maintenance failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => ctx.close());
