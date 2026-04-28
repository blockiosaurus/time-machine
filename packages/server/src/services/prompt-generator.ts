import { createHash } from 'node:crypto';
import { META_PROMPT, META_PROMPT_VERSION } from '@metaplex-agent/core';
import type { CanonicalizerResult } from '@metaplex-agent/shared';
import { complete } from './anthropic.js';

export interface GeneratedPrompt {
  systemPrompt: string;
  metaPromptVersion: string;
  fingerprint: string;
}

function fingerprint(figure: CanonicalizerResult, output: string): string {
  return createHash('sha256')
    .update(META_PROMPT_VERSION)
    .update('\n')
    .update(JSON.stringify(figure))
    .update('\n')
    .update(output)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Generate the in-character system prompt for a freshly-canonicalized figure.
 * Uses the META_PROMPT template + figure inputs against Haiku 4.5.
 *
 * Output is plain text and gets stored verbatim in `characters.system_prompt`.
 */
export async function generateSystemPrompt(
  figure: CanonicalizerResult,
): Promise<GeneratedPrompt> {
  const figureBlock = [
    `canonicalName: ${figure.canonicalName}`,
    `bioSummary: ${figure.bioSummary}`,
    `birthYear: ${figure.birthYear ?? 'unknown'}`,
    `deathYear: ${figure.deathYear ?? 'unknown'}`,
    `aliases: ${figure.aliases.join(', ') || '(none)'}`,
  ].join('\n');

  const userPrompt = `Figure inputs:\n${figureBlock}\n\nProduce the system prompt now.`;

  const text = await complete(userPrompt, {
    system: META_PROMPT,
    temperature: 0.7,
    maxTokens: 1500,
  });

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Prompt generator returned empty output');
  }

  return {
    systemPrompt: trimmed,
    metaPromptVersion: META_PROMPT_VERSION,
    fingerprint: fingerprint(figure, trimmed),
  };
}
