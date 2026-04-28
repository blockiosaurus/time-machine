import type { IncomingMessage, ServerResponse } from 'node:http';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { characters } from '../db/schema.js';
import { sendJson, sendError } from './http-utils.js';

function rowToPublic(row: typeof characters.$inferSelect) {
  return {
    slug: row.slug,
    canonicalName: row.canonicalName,
    bioSummary: row.bioSummary,
    birthYear: row.birthYear,
    deathYear: row.deathYear,
    portraitUri: `https://gateway.irys.xyz/${row.portraitIpfsCid}`,
    nftMint: row.nftMint,
    genesisTokenMint: row.genesisTokenMint,
    genesisTicker: row.genesisTicker,
    ownerWallet: row.ownerWallet,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
  };
}

/** GET /api/characters — list active characters. */
export async function handleListCharacters(
  _req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  const rows = await db
    .select()
    .from(characters)
    .where(eq(characters.status, 'active'))
    .orderBy(desc(characters.createdAt))
    .limit(200);
  sendJson(res, 200, { characters: rows.map(rowToPublic) });
}

/** GET /api/characters/:slug — single character lookup. */
export async function handleGetCharacterBySlug(
  _req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  slug: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(characters)
    .where(eq(characters.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) {
    sendError(res, 404, 'NOT_FOUND', `Character "${slug}" not found.`);
    return;
  }
  if (row.status === 'disabled') {
    sendError(res, 410, 'DISABLED', 'Character is disabled.');
    return;
  }
  sendJson(res, 200, rowToPublic(row));
}
