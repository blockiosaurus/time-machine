import type { IncomingMessage, ServerResponse } from 'node:http';
import { getConfig } from '@metaplex-agent/shared';
import { getDb } from '../db/index.js';
import { sendError, sendJson } from './http-utils.js';
import {
  handleMintCanonicalize,
  handleMintPreview,
  handleMintFinalize,
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

  // CORS preflight
  if (method === 'OPTIONS' && url.startsWith('/api/')) {
    sendJson(res, 204, '');
    return true;
  }

  // Health probes
  if (url === '/api/health') {
    sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
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
    if (method === 'POST' && url === '/api/mint/finalize') {
      await handleMintFinalize(req, res, db);
      return true;
    }
    if (method === 'POST' && url === '/api/mint/confirm') {
      await handleMintConfirm(req, res, db);
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
