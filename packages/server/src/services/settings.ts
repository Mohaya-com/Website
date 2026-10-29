import { eq, inArray } from 'drizzle-orm';
import { settings as settingsTable, type DbExecutor } from '@vms/db';
import { DEFAULT_SETTINGS, systemSettingsSchema, type SystemSettings } from '@vms/shared';
import type { StaffPrincipal } from '../auth/principal';
import type { ServerContext, TxScope } from '../context';
import { publish } from '../realtime';
import { audit } from './audit';

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SystemSettings)[];
const CACHE_MS = 10_000;
export const DEMO_DATA_KEY = 'meta.demoData';

export async function loadSettings(db: DbExecutor): Promise<SystemSettings> {
  const rows = await db.select().from(settingsTable).where(inArray(settingsTable.key, SETTINGS_KEYS));
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) merged[row.key] = row.value;
  const parsed = systemSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** Cached for a few seconds per process; updates invalidate the cache immediately. */
export async function getSettings(ctx: ServerContext): Promise<SystemSettings> {
  const cached = ctx.cache.settings;
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.value;
  const value = await loadSettings(ctx.db);
  ctx.cache.settings = { value, loadedAt: Date.now() };
  return value;
}

export async function isDemoData(db: DbExecutor): Promise<boolean> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, DEMO_DATA_KEY));
  return row?.value === true;
}

export async function updateSettings(ctx: ServerContext, scope: TxScope, admin: StaffPrincipal, input: SystemSettings): Promise<SystemSettings> {
  const current = await loadSettings(scope.tx);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of SETTINGS_KEYS) {
    if (current[key] !== input[key]) changes[key] = { from: current[key], to: input[key] };
  }
  for (const key of Object.keys(changes) as (keyof SystemSettings)[]) {
    await scope.tx
      .insert(settingsTable)
      .values({ key, value: input[key], updatedAt: scope.now, updatedByUserId: admin.userId })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: input[key], updatedAt: scope.now, updatedByUserId: admin.userId } });
  }
  if (Object.keys(changes).length) {
    await audit(scope.tx, { actor: { type: 'user', userId: admin.userId }, action: 'settings.updated', entityType: 'settings', metadata: { changes }, at: scope.now });
    await publish(scope.tx, { t: 'config' });
  }
  ctx.cache.settings = null;
  return input;
}
