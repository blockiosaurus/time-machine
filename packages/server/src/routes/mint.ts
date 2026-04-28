import type { IncomingMessage, ServerResponse } from 'node:http';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getConfig } from '@metaplex-agent/shared';
import type { Db } from '../db/index.js';
import { mintJobs } from '../db/schema.js';
import {
  startMintCanonicalize,
  generateMintPreview,
} from '../services/mint-orchestrator.js';
import { readJsonBody, sendJson, sendError } from './http-utils.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TICKER_RE = /^[A-Z]{3,10}$/;

const canonicalizeBody = z.object({
  rawName: z.string().min(1).max(200),
  wallet: z.string().regex(BASE58_RE),
});

const previewBody = z.object({
  mintJobId: z.string().uuid(),
  ticker: z.string().regex(TICKER_RE),
});

export async function handleMintCanonicalize(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  const body = await readJsonBody(req);
  const parsed = canonicalizeBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  const { rawName, wallet } = parsed.data;
  try {
    const out = await startMintCanonicalize(db, rawName, wallet);
    if (!out.result.ok) {
      sendJson(res, 200, {
        ok: false,
        jobId: out.jobId,
        reason: out.result.reason,
        message: out.result.message,
        existingSlug:
          out.result.reason === 'duplicate' ? out.result.existingSlug : undefined,
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      jobId: out.jobId,
      canonical: out.result.figure,
      suggestedSlug: out.result.suggestedSlug,
    });
  } catch (e) {
    console.error('[mint/canonicalize] failed:', e);
    sendError(res, 500, 'CANONICALIZE_ERROR', (e as Error).message);
  }
}

export async function handleMintPreview(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  const body = await readJsonBody(req);
  const parsed = previewBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  const { mintJobId, ticker } = parsed.data;
  const config = getConfig();

  // Look up the canonical record from the mint job.
  const rows = await db.select().from(mintJobs).where(eq(mintJobs.id, mintJobId)).limit(1);
  const job = rows[0];
  if (!job) {
    sendError(res, 404, 'JOB_NOT_FOUND', `Mint job ${mintJobId} not found.`);
    return;
  }
  if (job.status !== 'pending') {
    sendError(
      res,
      409,
      'JOB_BAD_STATE',
      `Mint job is in state "${job.status}" (need "pending" for preview).`,
    );
    return;
  }
  // The orchestrator stores canonicalizer output on first success in
  // `canonical_name`; bio + birth/death are stored in the steps blob. For now
  // we re-canonicalize on preview to keep the contract simple and avoid
  // schema bloat. Future: persist full canonicalizer result on the row.
  const canonical = job.canonicalName;
  if (!canonical) {
    sendError(res, 409, 'JOB_BAD_STATE', 'Mint job missing canonical name.');
    return;
  }

  // For preview we need the full CanonicalizerResult; call canonicalize again.
  // This is wasteful — TODO: persist the canonicalizer result on the job row.
  const { canonicalize } = await import('../services/canonicalizer.js');
  let re;
  try {
    re = await canonicalize(canonical);
  } catch (e) {
    console.error('[mint/preview] canonicalize replay threw:', e);
    sendError(res, 500, 'CANONICALIZE_REPLAY_FAILED', (e as Error).message);
    return;
  }
  if (!re.ok) {
    sendError(
      res,
      500,
      'CANONICALIZE_REPLAY_FAILED',
      `Re-canonicalization rejected: ${re.message}`,
    );
    return;
  }

  const chatEndpoint = `${
    process.env.PUBLIC_WS_BASE ?? 'wss://timemachine.example'
  }/chat/${re.canonicalName.toLowerCase().replace(/\s+/g, '-')}`;

  try {
    const preview = await generateMintPreview(db, {
      mintJobId,
      figure: re,
      ticker,
      chatEndpoint,
    });
    sendJson(res, 200, {
      ok: true,
      mintJobId,
      slug: preview.slug,
      portraitUri: preview.portraitIpfs.uri,
      promptCid: preview.promptIpfs.cid,
      portraitCid: preview.portraitIpfs.cid,
      registrationCid: preview.registrationIpfs.cid,
      characterMetadataCid: preview.characterMetadataIpfs.cid,
      characterMetadataUri: preview.characterMetadataIpfs.uri,
      moderation: preview.moderation,
      mintFeeLamports: config.MINT_FEE_LAMPORTS,
      // The actual recipient is resolved at finalize time and may default to
      // the agent PDA when not explicitly set; surface the override (or null)
      // here so the UI can display it for transparency.
      mintFeeRecipient: config.MINT_FEE_RECIPIENT ?? null,
      collection: config.COLLECTION_ADDRESS ?? null,
    });
  } catch (e) {
    console.error('[mint/preview] failed:', e);
    sendError(res, 500, 'PREVIEW_FAILED', (e as Error).message);
  }
}

const finalizeBody = z.object({
  mintJobId: z.string().uuid(),
  ownerWallet: z.string().regex(BASE58_RE),
});

const confirmBody = z.object({
  mintJobId: z.string().uuid(),
  signatures: z.array(z.string().min(64)).min(1).max(20),
});

export async function handleMintFinalize(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  const body = await readJsonBody(req);
  const parsed = finalizeBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  const { finalizeMint } = await import('../services/mint-finalize.js');
  try {
    const out = await finalizeMint(db, parsed.data);
    sendJson(res, 200, { ok: true, ...out });
  } catch (e) {
    console.error('[mint/finalize] failed:', e);
    sendError(res, 500, 'FINALIZE_FAILED', (e as Error).message);
  }
}

export async function handleMintConfirm(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  const body = await readJsonBody(req);
  const parsed = confirmBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  const { confirmMint } = await import('../services/mint-finalize.js');
  try {
    const out = await confirmMint(db, parsed.data);
    sendJson(res, 200, { ok: true, character: out });
  } catch (e) {
    console.error('[mint/confirm] failed:', e);
    sendError(res, 500, 'CONFIRM_FAILED', (e as Error).message);
  }
}
