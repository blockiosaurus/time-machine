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
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{43,88}$/;

const canonicalizeBody = z.object({
  rawName: z.string().min(1).max(200),
  wallet: z.string().regex(BASE58_RE),
});

const previewBody = z.object({
  mintJobId: z.string().uuid(),
  ticker: z.string().regex(TICKER_RE),
});

const buildFeeBody = z.object({
  mintJobId: z.string().uuid(),
  ownerWallet: z.string().regex(BASE58_RE),
});

const buildAssetBody = z.object({
  mintJobId: z.string().uuid(),
  ownerWallet: z.string().regex(BASE58_RE),
  feeSignature: z.string().regex(SIG_RE),
});

const buildGenesisBody = z.object({
  mintJobId: z.string().uuid(),
  ownerWallet: z.string().regex(BASE58_RE),
  assetSignature: z.string().regex(SIG_RE),
});

const confirmBody = z.object({
  mintJobId: z.string().uuid(),
  ownerWallet: z.string().regex(BASE58_RE),
  genesisSignatures: z.array(z.string().regex(SIG_RE)).min(1).max(20),
});

function chatEndpointFor(canonicalName: string): string {
  const slug = canonicalName.toLowerCase().replace(/\s+/g, '-');
  const base = process.env.PUBLIC_WS_BASE ?? 'wss://timemachine.example';
  return `${base.replace(/\/$/, '')}/chat/${slug}`;
}

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
  const canonical = job.canonicalName;
  if (!canonical) {
    sendError(res, 409, 'JOB_BAD_STATE', 'Mint job missing canonical name.');
    return;
  }

  // We need the full CanonicalizerResult; cheap re-canonicalize.
  // TODO: persist full canonicalizer result on the job row to skip this.
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
    sendError(res, 500, 'CANONICALIZE_REPLAY_FAILED', `Re-canonicalization rejected: ${re.message}`);
    return;
  }

  try {
    const preview = await generateMintPreview(db, {
      mintJobId,
      figure: re,
      ticker,
      chatEndpoint: chatEndpointFor(re.canonicalName),
    });
    sendJson(res, 200, {
      ok: true,
      mintJobId,
      slug: preview.slug,
      portraitUrl: `/api/mint-jobs/${mintJobId}/portrait`,
      moderation: preview.moderation,
      mintFeeLamports: config.MINT_FEE_LAMPORTS,
      collection: config.COLLECTION_ADDRESS ?? null,
    });
  } catch (e) {
    console.error('[mint/preview] failed:', e);
    sendError(res, 500, 'PREVIEW_FAILED', (e as Error).message);
  }
}

export async function handleMintBuildFeeTx(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  const body = await readJsonBody(req);
  const parsed = buildFeeBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  const { buildFeeTx } = await import('../services/mint-finalize.js');
  try {
    const out = await buildFeeTx(db, parsed.data);
    sendJson(res, 200, { ok: true, ...out });
  } catch (e) {
    console.error('[mint/build-fee-tx] failed:', e);
    sendError(res, 500, 'BUILD_FEE_FAILED', (e as Error).message);
  }
}

export async function handleMintBuildAssetTx(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  const body = await readJsonBody(req);
  const parsed = buildAssetBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  const { confirmFeeAndBuildAssetTx } = await import('../services/mint-finalize.js');
  // Need canonical name to build the chat endpoint; load from job row.
  const rows = await db.select().from(mintJobs).where(eq(mintJobs.id, parsed.data.mintJobId)).limit(1);
  const job = rows[0];
  if (!job?.canonicalName) {
    sendError(res, 404, 'JOB_NOT_FOUND', `Mint job ${parsed.data.mintJobId} missing canonical name.`);
    return;
  }
  try {
    const out = await confirmFeeAndBuildAssetTx(db, {
      ...parsed.data,
      chatEndpoint: chatEndpointFor(job.canonicalName),
    });
    sendJson(res, 200, { ok: true, ...out });
  } catch (e) {
    console.error('[mint/build-asset-tx] failed:', e);
    sendError(res, 500, 'BUILD_ASSET_FAILED', (e as Error).message);
  }
}

export async function handleMintBuildGenesisTxs(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<void> {
  const body = await readJsonBody(req);
  const parsed = buildGenesisBody.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_BODY', parsed.error.message);
    return;
  }
  const { buildGenesisTxs } = await import('../services/mint-finalize.js');
  try {
    const out = await buildGenesisTxs(db, parsed.data);
    sendJson(res, 200, { ok: true, ...out });
  } catch (e) {
    const err = e as Error & { responseBody?: unknown; statusCode?: number };
    console.error('[mint/build-genesis-txs] failed:', err);
    if (err.responseBody) {
      console.error(
        '[mint/build-genesis-txs] Genesis API response body:\n' +
        JSON.stringify(err.responseBody, null, 2),
      );
    }
    sendError(res, 500, 'BUILD_GENESIS_FAILED', err.message);
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
