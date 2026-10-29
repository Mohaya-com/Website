import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrator';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, '../../../.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.argv.includes('--test') ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  process.exit(1);
}

runMigrations(url)
  .then(() => {
    console.log('✔ Database migrations applied');
  })
  .catch((err: Error) => {
    console.error('✘ Migration failed:', err.message);
    process.exit(1);
  });
