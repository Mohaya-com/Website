import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { createDb } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = path.resolve(here, '../migrations');

/** Applies pending SQL migrations (tracked in drizzle.__drizzle_migrations). */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

/**
 * DESTRUCTIVE — development and tests only. Drops every table (including the append-only audit log)
 * by recreating the schema, then re-applies all migrations.
 */
export async function resetDatabase(connectionString: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('resetDatabase is disabled in production');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await runMigrations(connectionString);
}
