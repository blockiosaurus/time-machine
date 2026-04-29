import type { IncomingMessage, ServerResponse } from 'node:http';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { mintJobs } from '../db/schema.js';
import { sendError } from './http-utils.js';

/**
 * GET /api/mint-jobs/:id/portrait — serves the freshly-generated portrait
 * stored on the mint_job row during preview, before it's pinned to Irys at
 * finalize time. Once finalize completes, the bytes column is nulled and
 * clients should switch to the Irys gateway URL.
 */
export async function handleMintJobPortrait(
  _req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  jobId: string,
): Promise<void> {
  const rows = await db
    .select({
      bytes: mintJobs.portraitBytes,
      steps: mintJobs.steps,
    })
    .from(mintJobs)
    .where(eq(mintJobs.id, jobId))
    .limit(1);
  const row = rows[0];
  if (!row || !row.bytes) {
    sendError(res, 404, 'NOT_FOUND', 'Portrait not available for this mint job.');
    return;
  }
  const preview = (row.steps as Record<string, unknown>).preview as
    | { portraitContentType?: string }
    | undefined;
  res.statusCode = 200;
  res.setHeader('Content-Type', preview?.portraitContentType ?? 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(row.bytes);
}
