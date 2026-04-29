import { eq } from 'drizzle-orm';
import type { CanonicalizerResult } from '@metaplex-agent/shared';
import { META_PROMPT_VERSION } from '@metaplex-agent/core';
import type { Db } from '../db/index.js';
import { mintJobs } from '../db/schema.js';
import { canonicalize } from './canonicalizer.js';
import { fuzzyMatchCheck } from './fuzzy-match.js';
import { generateSystemPrompt } from './prompt-generator.js';
import { generatePortrait } from './image-generator.js';
import { moderatePrompt } from './moderation.js';
import { slugify } from './normalize.js';

export interface PreviewArgs {
  mintJobId: string;
  figure: CanonicalizerResult;
  ticker: string;
  chatEndpoint: string;
}

export interface PreviewResult {
  slug: string;
  systemPrompt: string;
  promptFingerprint: string;
  metaPromptVersion: string;
  moderation: { ok: boolean; regenerated: boolean };
}

async function setStep(
  db: Db,
  jobId: string,
  step: string,
  status: 'running' | 'done' | 'failed',
  extra?: { error?: string },
) {
  const rows = await db.select().from(mintJobs).where(eq(mintJobs.id, jobId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`mint_job ${jobId} not found`);
  const steps = (row.steps as Record<string, unknown>) ?? {};
  const now = new Date().toISOString();
  const prior = (steps[step] as Record<string, unknown>) ?? {};
  steps[step] = {
    ...prior,
    status,
    ...(status === 'running' && !prior.startedAt ? { startedAt: now } : {}),
    ...(status === 'done' || status === 'failed' ? { completedAt: now } : {}),
    ...(extra?.error ? { error: extra.error } : {}),
  };
  await db
    .update(mintJobs)
    .set({ steps, updatedAt: new Date() })
    .where(eq(mintJobs.id, jobId));
}

/**
 * Step 1 of the mint flow. Hits the LLM canonicalizer + fuzzy-match guard.
 * Persists a mint_job row regardless of outcome (audit trail).
 */
export async function startMintCanonicalize(
  db: Db,
  rawName: string,
  wallet: string,
): Promise<{
  jobId: string;
  result:
    | { ok: true; figure: CanonicalizerResult; suggestedSlug: string }
    | {
        ok: false;
        reason: 'rejected' | 'duplicate';
        message: string;
        existingSlug?: string;
      };
}> {
  const inserted = await db
    .insert(mintJobs)
    .values({
      requestedName: rawName,
      wallet,
      status: 'canonicalizing',
      steps: {},
    })
    .returning({ id: mintJobs.id });
  const jobId = inserted[0]!.id;

  await setStep(db, jobId, 'canonicalize', 'running');
  let canon;
  try {
    canon = await canonicalize(rawName);
  } catch (e) {
    const msg = (e as Error).message;
    await setStep(db, jobId, 'canonicalize', 'failed', { error: msg });
    await db
      .update(mintJobs)
      .set({ status: 'failed', error: msg, updatedAt: new Date() })
      .where(eq(mintJobs.id, jobId));
    throw e;
  }
  await setStep(db, jobId, 'canonicalize', 'done');

  if (!canon.ok) {
    await db
      .update(mintJobs)
      .set({
        status: 'failed',
        error: `${canon.reason}: ${canon.message}`,
        canonicalName: null,
        updatedAt: new Date(),
      })
      .where(eq(mintJobs.id, jobId));
    return {
      jobId,
      result: { ok: false, reason: 'rejected', message: canon.message },
    };
  }

  await setStep(db, jobId, 'fuzzy_match', 'running');
  const hit = await fuzzyMatchCheck(db, canon.canonicalName);
  await setStep(db, jobId, 'fuzzy_match', hit ? 'failed' : 'done');

  if (hit) {
    await db
      .update(mintJobs)
      .set({
        status: 'fuzzy_match_failed',
        canonicalName: canon.canonicalName,
        error: `duplicate of ${hit.canonicalName} (matched on ${hit.matchedOn})`,
        updatedAt: new Date(),
      })
      .where(eq(mintJobs.id, jobId));
    return {
      jobId,
      result: {
        ok: false,
        reason: 'duplicate',
        message: `"${canon.canonicalName}" already exists.`,
        existingSlug: hit.slug,
      },
    };
  }

  await db
    .update(mintJobs)
    .set({
      canonicalName: canon.canonicalName,
      status: 'pending',
      updatedAt: new Date(),
    })
    .where(eq(mintJobs.id, jobId));

  return {
    jobId,
    result: {
      ok: true,
      figure: canon,
      suggestedSlug: slugify(canon.canonicalName),
    },
  };
}

/**
 * Step 2 of the mint flow. Generates prompt + image + runs moderation, but
 * does NOT pin to Irys. Bytes + text are stored on the mint_jobs row. The
 * UI fetches the portrait via `/api/mint-jobs/<id>/portrait` for preview
 * display. Irys uploads are deferred to finalize so abandoned previews
 * don't drain the agent wallet.
 */
export async function generateMintPreview(
  db: Db,
  args: PreviewArgs,
): Promise<PreviewResult> {
  const { mintJobId, figure, ticker } = args;

  await db
    .update(mintJobs)
    .set({ status: 'generating', updatedAt: new Date() })
    .where(eq(mintJobs.id, mintJobId));

  // 1. Prompt generation + moderation (with one regenerate retry).
  await setStep(db, mintJobId, 'prompt_gen', 'running');
  let prompt = await generateSystemPrompt(figure);
  let verdict = await moderatePrompt(prompt.systemPrompt);
  let regenerated = false;
  if (!verdict.ok) {
    console.warn(
      `[mint] moderation flagged first attempt for ${figure.canonicalName}:`,
      verdict.reasons,
    );
    regenerated = true;
    prompt = await generateSystemPrompt(figure);
    verdict = await moderatePrompt(prompt.systemPrompt);
  }
  if (!verdict.ok) {
    const reasons = verdict.reasons.join(',') || '(no reasons given)';
    console.error(
      `[mint] moderation flagged twice for ${figure.canonicalName}; reasons=${reasons}; ` +
      `prompt preview: ${prompt.systemPrompt.slice(0, 300)}…`,
    );
    await setStep(db, mintJobId, 'prompt_gen', 'failed', {
      error: `moderation flagged twice: ${reasons}`,
    });
    await db
      .update(mintJobs)
      .set({
        status: 'failed',
        error: `moderation flagged twice: ${reasons}`,
        updatedAt: new Date(),
      })
      .where(eq(mintJobs.id, mintJobId));
    throw new Error(`Generated prompt failed moderation twice (${reasons})`);
  }
  await setStep(db, mintJobId, 'prompt_gen', 'done');

  // 2. Image gen.
  await setStep(db, mintJobId, 'image_gen', 'running');
  const portraitGen = await generatePortrait(figure.canonicalName);
  await setStep(db, mintJobId, 'image_gen', 'done');

  const slug = slugify(figure.canonicalName);

  // Persist preview state on the row. Bytes + prompt text live in dedicated
  // columns so we can serve them efficiently; everything else goes into the
  // steps blob.
  const existingSteps = (
    (await db
      .select({ s: mintJobs.steps })
      .from(mintJobs)
      .where(eq(mintJobs.id, mintJobId))
      .limit(1))[0]?.s ?? {}
  ) as Record<string, unknown>;
  await db
    .update(mintJobs)
    .set({
      status: 'awaiting_fee',
      portraitBytes: Buffer.from(portraitGen.bytes),
      promptText: prompt.systemPrompt,
      steps: {
        ...existingSteps,
        preview: {
          canonicalName: figure.canonicalName,
          bioSummary: figure.bioSummary,
          birthYear: figure.birthYear,
          deathYear: figure.deathYear,
          aliases: figure.aliases,
          ticker,
          slug,
          systemPrompt: prompt.systemPrompt,
          promptFingerprint: prompt.fingerprint,
          metaPromptVersion: prompt.metaPromptVersion,
          portraitContentType: portraitGen.contentType,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(mintJobs.id, mintJobId));

  return {
    slug,
    systemPrompt: prompt.systemPrompt,
    promptFingerprint: prompt.fingerprint,
    metaPromptVersion: prompt.metaPromptVersion,
    moderation: { ok: true, regenerated },
  };
}
