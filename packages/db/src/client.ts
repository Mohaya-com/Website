import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
}

/** Return timestamps as Date and DATE columns as plain strings (no time-zone shifting). */
pg.types.setTypeParser(1082, (value: string) => value);

export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'compound-vms',
  });
  pool.on('error', (err) => {
    // Avoid crashing the process on idle-client errors; details are logged without query data.
    console.error('[db] idle client error:', err.message);
  });
  const db = drizzle(pool, { schema, casing: undefined });
  return { db, pool };
}
