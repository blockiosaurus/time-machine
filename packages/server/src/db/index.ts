import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

let pool: pg.Pool | null = null;

export function getDb(databaseUrl: string) {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
