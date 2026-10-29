import type pg from 'pg';
import { createDb, type Database, type DbExecutor } from '@vms/db';
import type { SystemSettings } from '@vms/shared';
import { systemClock, type Clock } from './clock';
import { loadConfig, loadRootEnv, type ServerConfig } from './config';
import { describeError, logger } from './logger';
import { createPushProvider, type PushProvider } from './providers/push';
import { createSmsProvider, type SmsProvider } from './providers/sms';
import { RealtimeBus } from './realtime';
import type { StoredWhatsApp } from './services/whatsapp';

export interface ServerContext {
  config: ServerConfig;
  db: Database;
  pool: pg.Pool;
  clock: Clock;
  sms: SmsProvider;
  push: PushProvider;
  realtime: RealtimeBus;
  cache: {
    settings: { value: SystemSettings; loadedAt: number } | null;
    whatsapp: { value: StoredWhatsApp | null; loadedAt: number } | null;
    lastFreshnessSweep: number;
  };
  close(): Promise<void>;
}

export interface CreateContextOptions {
  config?: ServerConfig;
  clock?: Clock;
  sms?: SmsProvider;
  push?: PushProvider;
}

export function createServerContext(options: CreateContextOptions = {}): ServerContext {
  const config = options.config ?? loadConfig();
  const { db, pool } = createDb(config.databaseUrl, { max: config.databasePoolMax });
  const realtime = new RealtimeBus(config.databaseUrl);
  return {
    config,
    db,
    pool,
    clock: options.clock ?? systemClock,
    sms: options.sms ?? createSmsProvider(config),
    push: options.push ?? createPushProvider(config),
    realtime,
    cache: { settings: null, whatsapp: null, lastFreshnessSweep: 0 },
    async close() {
      await realtime.close();
      await pool.end();
    },
  };
}

const GLOBAL_KEY = Symbol.for('vms.serverContext');
type GlobalWithContext = typeof globalThis & { [GLOBAL_KEY]?: ServerContext };

/** Process-wide context (survives Next.js hot reloads in development). */
export function getServerContext(): ServerContext {
  const g = globalThis as GlobalWithContext;
  if (!g[GLOBAL_KEY]) {
    loadRootEnv();
    g[GLOBAL_KEY] = createServerContext();
  }
  return g[GLOBAL_KEY];
}

/** Side effects (push delivery) queued during a transaction and executed only after it commits. */
export type Effect = () => Promise<unknown> | unknown;

export interface TxScope {
  tx: DbExecutor;
  now: Date;
  effects: Effect[];
}

export async function inTransaction<T>(ctx: ServerContext, fn: (scope: TxScope) => Promise<T>): Promise<T> {
  const effects: Effect[] = [];
  const now = ctx.clock.now();
  const result = await ctx.db.transaction(async (tx) => fn({ tx, now, effects }));
  for (const effect of effects) {
    void Promise.resolve()
      .then(effect)
      .catch((err) => logger.warn('effect.failed', describeError(err)));
  }
  return result;
}
