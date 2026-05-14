import type { IncomingMessage, ServerResponse } from 'node:http';
import { and, desc, eq } from 'drizzle-orm';
import { getConfig } from '@metaplex-agent/shared';
import type { Db } from '../db/index.js';
import { characters } from '../db/schema.js';
import { currentNetwork } from '../services/network.js';
import { sendJson, sendError } from './http-utils.js';

function rowToPublic(row: typeof characters.$inferSelect) {
  const apiBase = getConfig().PUBLIC_API_URL.replace(/\/$/, '');
  return {
    slug: row.slug,
    canonicalName: row.canonicalName,
    bioSummary: row.bioSummary,
    birthYear: row.birthYear,
    deathYear: row.deathYear,
    // Portrait is served from our server — no Irys dependency, no
    // network-specific gateway routing needed.
    portraitUri: `${apiBase}/api/characters/${row.slug}/portrait`,
    nftMint: row.nftMint,
    genesisTokenMint: row.genesisTokenMint,
    genesisTicker: row.genesisTicker,
    ownerWallet: row.ownerWallet,
    network: row.network,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
  };
}

/** GET /api/characters — list active characters on the current network. */
export async function handleListCharacters(
  _req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  const network = currentNetwork();
  const rows = await db
    .select()
    .from(characters)
    .where(and(eq(characters.network, network), eq(characters.status, 'active')))
    .orderBy(desc(characters.createdAt))
    .limit(200);
  sendJson(res, 200, { characters: rows.map(rowToPublic) });
}

/** GET /api/characters/:slug — single character lookup, current network only. */
export async function handleGetCharacterBySlug(
  _req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  slug: string,
): Promise<void> {
  const network = currentNetwork();
  const rows = await db
    .select()
    .from(characters)
    .where(and(eq(characters.network, network), eq(characters.slug, slug)))
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
