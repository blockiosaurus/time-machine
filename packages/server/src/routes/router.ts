import type { IncomingMessage, ServerResponse } from 'node:http';
import { getConfig } from '@metaplex-agent/shared';
import { getDb } from '../db/index.js';
import { sendError, sendJson } from './http-utils.js';
import {
  handleMintCanonicalize,
  handleMintPreview,
  handleMintBuildFeeTx,
  handleMintBuildAssetTx,
  handleMintBuildGenesisTxs,
  handleMintConfirm,
} from './mint.js';
import {
  handleListCharacters,
  handleGetCharacterBySlug,
} from './characters.js';
import {
  handleAdminRegeneratePrompt,
  handleAdminRegeneratePortrait,
  handleAdminSetStatus,
  handleAdminListTickets,
} from './admin.js';
import { handleMintJobPortrait } from './portrait.js';
import { handleGetConfig } from './config.js';
import {
  handleCharacterPortrait,
  handleCharacterMetadataJson,
  handleCharacterRegistrationJson,
} from './character-assets.js';

/**
 * Top-level HTTP router. Returns true if the request was handled, false
 * otherwise (so the WebSocket upgrade path can keep working).
 */
export async function routeHttp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS' && url.startsWith('/api/')) {
    sendJson(res, 204, '');
    return true;
  }

  if (url === '/api/health') {
    sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
    return true;
  }

  if (method === 'GET' && url === '/api/config') {
    await handleGetConfig(req, res);
    return true;
  }

  if (!url.startsWith('/api/')) return false;

  const config = getConfig();
  const db = getDb(config.DATABASE_URL);

  try {
    if (method === 'POST' && url === '/api/mint/canonicalize') {
      await handleMintCanonicalize(req, res, db);
      return true;
    }
    if (method === 'POST' && url === '/api/mint/preview') {
      await handleMintPreview(req, res, db);
      return true;
    }
    if (method === 'POST' && url === '/api/mint/build-fee-tx') {
      await handleMintBuildFeeTx(req, res, db);
      return true;
    }
    if (method === 'POST' && url === '/api/mint/build-asset-tx') {
      await handleMintBuildAssetTx(req, res, db);
      return true;
    }
    if (method === 'POST' && url === '/api/mint/build-genesis-txs') {
      await handleMintBuildGenesisTxs(req, res, db);
      return true;
    }
    if (method === 'POST' && url === '/api/mint/confirm') {
      await handleMintConfirm(req, res, db);
      return true;
    }
    const portraitMatch = /^\/api\/mint-jobs\/([0-9a-f-]{36})\/portrait$/.exec(url);
    if (method === 'GET' && portraitMatch) {
      await handleMintJobPortrait(req, res, db, portraitMatch[1]!);
      return true;
    }
    if (method === 'GET' && url === '/api/characters') {
      await handleListCharacters(req, res, db);
      return true;
    }
    const slugMatch = /^\/api\/characters\/([a-z0-9-]+)$/.exec(url);
    if (method === 'GET' && slugMatch) {
      await handleGetCharacterBySlug(req, res, db, slugMatch[1]!);
      return true;
    }
    const portraitMatch2 = /^\/api\/characters\/([a-z0-9-]+)\/portrait$/.exec(url);
    if (method === 'GET' && portraitMatch2) {
      await handleCharacterPortrait(req, res, db, portraitMatch2[1]!);
      return true;
    }
    const metadataMatch = /^\/api\/characters\/([a-z0-9-]+)\/metadata\.json$/.exec(url);
    if (method === 'GET' && metadataMatch) {
      await handleCharacterMetadataJson(req, res, db, metadataMatch[1]!);
      return true;
    }
    const registrationMatch = /^\/api\/characters\/([a-z0-9-]+)\/registration\.json$/.exec(url);
    if (method === 'GET' && registrationMatch) {
      await handleCharacterRegistrationJson(req, res, db, registrationMatch[1]!);
      return true;
    }
    if (method === 'POST' && url === '/api/admin/regenerate-prompt') {
      await handleAdminRegeneratePrompt(req, res, db);
      return true;
    }
    if (method === 'POST' && url === '/api/admin/regenerate-portrait') {
      await handleAdminRegeneratePortrait(req, res, db);
      return true;
    }
    if (method === 'POST' && url === '/api/admin/set-status') {
      await handleAdminSetStatus(req, res, db);
      return true;
    }
    if (method === 'GET' && url === '/api/admin/tickets') {
      await handleAdminListTickets(req, res, db);
      return true;
    }

    sendError(res, 404, 'NOT_FOUND', `No route for ${method} ${url}`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[http] ${method} ${url} failed:`, e);
    sendError(res, 500, 'INTERNAL', msg);
    return true;
  }
}
