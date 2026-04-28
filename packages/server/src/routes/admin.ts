import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { getConfig } from '@metaplex-agent/shared';
import type { Db } from '../db/index.js';
import { sendJson, sendError, readJsonBody } from './http-utils.js';
import {
  regeneratePromptForCharacter,
  regeneratePortraitForCharacter,
  setCharacterStatus,
  listOpenModerationTickets,
} from '../services/admin-actions.js';

const SLUG_RE = /^[a-z0-9-]+$/;

const regenBody = z.object({ slug: z.string().regex(SLUG_RE) });
const statusBody = z.object({
  slug: z.string().regex(SLUG_RE),
  status: z.enum(['active', 'flagged', 'disabled', 'regenerating']),
});

/**
 * Authorize the request: the caller must include `x-admin-wallet` header
 * matching one of the wallets in ADMIN_WALLETS. (For v1 we trust the
 * header; v1.5 should require a signed challenge.)
 */
function isAdmin(req: IncomingMessage): boolean {
  const claimed = req.headers['x-admin-wallet'];
  if (typeof claimed !== 'string' || !claimed) return false;
  return getConfig().ADMIN_WALLETS.includes(claimed);
}

export async function handleAdminRegeneratePrompt(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  if (!isAdmin(req)) {
    sendError(res, 403, 'NOT_ADMIN', 'Admin wallet header missing or unauthorized.');
    return;
  }
  const body = await readJsonBody(req);
  const parsed = regenBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  try {
    const out = await regeneratePromptForCharacter(db, parsed.data.slug);
    sendJson(res, 200, { ok: true, ...out });
  } catch (e) {
    sendError(res, 500, 'REGEN_FAILED', (e as Error).message);
  }
}

export async function handleAdminRegeneratePortrait(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  if (!isAdmin(req)) {
    sendError(res, 403, 'NOT_ADMIN', 'Admin wallet header missing or unauthorized.');
    return;
  }
  const body = await readJsonBody(req);
  const parsed = regenBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  try {
    const out = await regeneratePortraitForCharacter(db, parsed.data.slug);
    sendJson(res, 200, { ok: true, ...out });
  } catch (e) {
    sendError(res, 500, 'REGEN_FAILED', (e as Error).message);
  }
}

export async function handleAdminSetStatus(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  if (!isAdmin(req)) {
    sendError(res, 403, 'NOT_ADMIN', 'Admin wallet header missing or unauthorized.');
    return;
  }
  const body = await readJsonBody(req);
  const parsed = statusBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  try {
    await setCharacterStatus(db, parsed.data.slug, parsed.data.status);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendError(res, 500, 'STATUS_FAILED', (e as Error).message);
  }
}

export async function handleAdminListTickets(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  if (!isAdmin(req)) {
    sendError(res, 403, 'NOT_ADMIN', 'Admin wallet header missing or unauthorized.');
    return;
  }
  const tickets = await listOpenModerationTickets(db);
  sendJson(res, 200, { tickets });
}
