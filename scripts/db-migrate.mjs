#!/usr/bin/env node
/**
 * Pure-JS migration runner. Applies packages/server/src/db/schema.sql to
 * whatever DATABASE_URL points at. Idempotent (the schema uses
 * CREATE ... IF NOT EXISTS). No tsx, no pnpm — just `node`. This is what
 * Railway's preDeployCommand invokes.
 *
 * Usage:
 *   node scripts/db-migrate.mjs
 *   DATABASE_URL=$RAILWAY_URL node scripts/db-migrate.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Pick up .env locally; on Railway the env is already set so this is a no-op.
const envFile = resolve(repoRoot, '.env');
if (existsSync(envFile)) loadDotenv({ path: envFile });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const schemaPath = resolve(repoRoot, 'packages/server/src/db/schema.sql');
const sql = readFileSync(schemaPath, 'utf8');

const redacted = url.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
console.log(`Applying schema to ${redacted}`);

const client = new pg.Client({
  connectionString: url,
  // Railway's managed Postgres uses a self-signed cert chain; allow it.
  ssl: url.includes('railway') || url.includes('amazonaws')
    ? { rejectUnauthorized: false }
    : undefined,
});

try {
  await client.connect();
  await client.query(sql);
  console.log('Schema applied.');
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
