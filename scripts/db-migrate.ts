/**
 * Apply packages/server/src/db/schema.sql to whatever database DATABASE_URL
 * points at. The schema uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF
 * NOT EXISTS, so this is safe to run repeatedly.
 *
 * Usage:
 *   pnpm db:migrate                # local dev (reads .env)
 *   DATABASE_URL=$RAILWAY_URL pnpm db:migrate   # prod
 *
 * For local dev, this is mostly a no-op — the docker-compose Postgres
 * applies schema.sql automatically on first boot via its init mount.
 * Useful when you've added migrations and need to apply them mid-flight,
 * or in production where the init mount doesn't exist.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Load .env from the repo root — same logic as packages/shared/src/config.ts.
loadDotenv({ path: resolve(repoRoot, '.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env or pass inline.');
  process.exit(1);
}

function redact(connStr: string): string {
  return connStr.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
}

async function main() {
  const schemaPath = resolve(repoRoot, 'packages/server/src/db/schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');

  console.log(`Applying schema to ${redact(url!)}`);

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(sql);
    console.log('Schema applied.');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', (e as Error).message);
  process.exit(1);
});
