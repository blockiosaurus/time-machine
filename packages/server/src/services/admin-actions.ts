import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { characters as charactersTable, moderationTickets } from '../db/schema.js';
import { canonicalize } from './canonicalizer.js';
import { generateSystemPrompt } from './prompt-generator.js';
import { generatePortrait } from './image-generator.js';
import { moderatePrompt } from './moderation.js';
import { pinJson, pinBytes } from './irys.js';
import { currentNetwork } from './network.js';

export async function regeneratePromptForCharacter(
  db: Db,
  slug: string,
): Promise<{ promptCid: string }> {
  const rows = await db
    .select()
    .from(charactersTable)
    .where(and(eq(charactersTable.network, currentNetwork()), eq(charactersTable.slug, slug)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Character "${slug}" not found`);

  // Re-canonicalize to grab a structured CanonicalizerResult.
  const canon = await canonicalize(row.canonicalName);
  if (!canon.ok) throw new Error('Re-canonicalization failed: ' + canon.message);

  const prompt = await generateSystemPrompt(canon);
  const verdict = await moderatePrompt(prompt.systemPrompt);
  if (!verdict.ok) {
    throw new Error('Regenerated prompt failed moderation: ' + verdict.reasons.join(','));
  }

  const ipfs = await pinJson({
    systemPrompt: prompt.systemPrompt,
    metaPromptVersion: prompt.metaPromptVersion,
    fingerprint: prompt.fingerprint,
    figure: canon,
  });

  await db
    .update(charactersTable)
    .set({
      systemPrompt: prompt.systemPrompt,
      promptIpfsCid: ipfs.cid,
      bioSummary: canon.bioSummary,
      birthYear: canon.birthYear,
      deathYear: canon.deathYear,
      aliases: canon.aliases,
      status: 'active',
    })
    .where(eq(charactersTable.id, row.id));

  return { promptCid: ipfs.cid };
}

export async function regeneratePortraitForCharacter(
  db: Db,
  slug: string,
): Promise<{ portraitCid: string }> {
  const rows = await db
    .select()
    .from(charactersTable)
    .where(and(eq(charactersTable.network, currentNetwork()), eq(charactersTable.slug, slug)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Character "${slug}" not found`);

  const generated = await generatePortrait(row.canonicalName);
  const ipfs = await pinBytes(generated.bytes, generated.contentType);

  await db
    .update(charactersTable)
    .set({ portraitIpfsCid: ipfs.cid })
    .where(eq(charactersTable.id, row.id));

  return { portraitCid: ipfs.cid };
}

export async function setCharacterStatus(
  db: Db,
  slug: string,
  status: 'active' | 'flagged' | 'disabled' | 'regenerating',
): Promise<void> {
  await db
    .update(charactersTable)
    .set({ status })
    .where(and(eq(charactersTable.network, currentNetwork()), eq(charactersTable.slug, slug)));
}

export async function listOpenModerationTickets(db: Db) {
  return await db
    .select()
    .from(moderationTickets)
    .where(eq(moderationTickets.status, 'open'));
}
