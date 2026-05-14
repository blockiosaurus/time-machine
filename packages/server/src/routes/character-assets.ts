/**
 * Server-hosted character assets — replaces Irys pinning entirely.
 *
 *   GET /api/characters/:slug/portrait         → raw image bytes from DB
 *   GET /api/characters/:slug/metadata.json    → Core NFT metadata JSON
 *   GET /api/characters/:slug/registration.json → Agent Registry doc
 *
 * The on-chain references (asset URI, registration URI, Genesis token
 * image URL) point at these endpoints. Trade-off: if the server goes down,
 * on-chain resources stop resolving. For Time Machine v1 we accept this —
 * we're the platform, we run the server, and skipping Irys removes a
 * flaky dependency.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { and, eq } from 'drizzle-orm';
import {
  buildAgentRegistrationDoc,
  buildCharacterMetadataDoc,
  getConfig,
  type SolanaNetwork,
} from '@metaplex-agent/shared';
import type { Db } from '../db/index.js';
import { characters } from '../db/schema.js';
import { currentNetwork } from '../services/network.js';
import { sendError, sendJson } from './http-utils.js';

function portraitUrl(slug: string): string {
  return `${getConfig().PUBLIC_API_URL.replace(/\/$/, '')}/api/characters/${slug}/portrait`;
}

function metadataUrl(slug: string): string {
  return `${getConfig().PUBLIC_API_URL.replace(/\/$/, '')}/api/characters/${slug}/metadata.json`;
}

function registrationUrl(slug: string): string {
  return `${getConfig().PUBLIC_API_URL.replace(/\/$/, '')}/api/characters/${slug}/registration.json`;
}

function chatEndpointFor(slug: string): string {
  const base = process.env.PUBLIC_WS_BASE ?? getConfig().PUBLIC_BASE_URL.replace(/^http/, 'ws');
  return `${base.replace(/\/$/, '')}/chat/${slug}`;
}

/**
 * Helpers exported for the mint flow so all parts of the system agree on
 * which URLs a character row resolves to.
 */
export const characterUrls = {
  portrait: portraitUrl,
  metadata: metadataUrl,
  registration: registrationUrl,
  chat: chatEndpointFor,
};

export async function handleCharacterPortrait(
  _req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  slug: string,
): Promise<void> {
  const rows = await db
    .select({
      bytes: characters.portraitBytes,
      ct: characters.portraitContentType,
    })
    .from(characters)
    .where(and(eq(characters.network, currentNetwork()), eq(characters.slug, slug)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.bytes) {
    sendError(res, 404, 'NOT_FOUND', 'Portrait not found.');
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', row.ct ?? 'image/png');
  // Long cache — character portraits are immutable per slug unless an
  // admin regenerates them.
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(row.bytes);
}

export async function handleCharacterMetadataJson(
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
    sendError(res, 404, 'NOT_FOUND', 'Character not found.');
    return;
  }
  const doc = buildCharacterMetadataDoc({
    canonicalName: row.canonicalName,
    slug: row.slug,
    bioSummary: row.bioSummary,
    portraitUri: portraitUrl(row.slug),
    promptCid: row.promptIpfsCid ?? '',
    portraitCid: row.portraitIpfsCid ?? '',
    registrationCid: row.registrationIpfsCid ?? '',
    metaPromptVersion: '',
    promptFingerprint: '',
    birthYear: row.birthYear,
    deathYear: row.deathYear,
    ticker: row.genesisTicker,
  });
  sendJson(res, 200, doc);
}

export async function handleCharacterRegistrationJson(
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
    sendError(res, 404, 'NOT_FOUND', 'Character not found.');
    return;
  }
  const doc = buildAgentRegistrationDoc({
    canonicalName: row.canonicalName,
    bioSummary: row.bioSummary,
    portraitUri: portraitUrl(row.slug),
    chatEndpoint: chatEndpointFor(row.slug),
  });
  sendJson(res, 200, doc);
}

// Re-export the SolanaNetwork type so this module is self-contained
// for downstream importers.
export type { SolanaNetwork };
