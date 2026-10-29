import { resetDatabase } from '@vms/db/migrator';
import { loadRootEnv } from '../config';

/** Recreates the test database schema once per test run. Never points at DATABASE_URL. */
export default async function setup() {
  loadRootEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');
  await resetDatabase(url);
}
