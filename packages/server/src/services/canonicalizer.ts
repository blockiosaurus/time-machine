import type { CanonicalizerResponse } from '@metaplex-agent/shared';
import { completeJson } from './llm.js';

export const CANONICALIZER_RUBRIC = `
You normalize user requests for historical-figure characters in the Time Machine product.

Given a raw user input, return a single JSON object matching one of:

{
  "ok": true,
  "canonicalName": "Albert Einstein",
  "bioSummary": "German-born theoretical physicist (1879-1955) who developed the theory of relativity.",
  "birthYear": 1879,
  "deathYear": 1955,
  "aliases": ["Einstein", "A. Einstein"],
  "suggestedTicker": "EINSTEIN"
}

OR

{
  "ok": false,
  "reason": "fictional" | "living" | "too_recent" | "mass_violence" | "ambiguous" | "not_found" | "policy",
  "message": "Plain-English explanation suitable to show the user."
}

Rejection rules (apply in order, return the FIRST that matches):
1. fictional -- the input refers to a fictional or mythological character
   (Sherlock Holmes, Zeus, Frodo). REJECT.
2. living -- the figure is currently alive. REJECT.
3. too_recent -- the figure died less than 25 years before {{today}}. REJECT.
4. mass_violence -- the figure is primarily known as a perpetrator of
   genocide, mass murder, or mass terrorism. REJECT.
5. ambiguous -- multiple equally-prominent figures match the input and you
   cannot pick one with high confidence. REJECT and list them in the message.
6. not_found -- you cannot identify a real historical figure from the input.
   REJECT.

Output rules:
- canonicalName uses the form most readers would recognize ("Albert Einstein"
  not "Einstein, Albert").
- bioSummary is one sentence, factual, neutral.
- aliases include common short forms ("Einstein"), variant spellings, and
  any well-known epithets. Do not include disrespectful nicknames.
- suggestedTicker is 3-10 uppercase A-Z characters; pick something readable
  and distinctive ("EINSTEIN", not "ALBEINS").
- Output JSON ONLY. No prose, no code fences.
`.trim();

interface RawCanonResponse {
  ok?: boolean;
  canonicalName?: unknown;
  bioSummary?: unknown;
  birthYear?: unknown;
  deathYear?: unknown;
  aliases?: unknown;
  suggestedTicker?: unknown;
  reason?: unknown;
  message?: unknown;
}

const VALID_REASONS = new Set([
  'fictional',
  'living',
  'too_recent',
  'mass_violence',
  'ambiguous',
  'not_found',
  'policy',
]);

const TICKER_RE = /^[A-Z]{3,10}$/;

/**
 * Validate and normalize the LLM response into a typed CanonicalizerResponse.
 * Throws if the shape is malformed (the caller should retry or surface as
 * mint failure).
 */
function validate(raw: RawCanonResponse): CanonicalizerResponse {
  if (raw.ok === false) {
    const reason = typeof raw.reason === 'string' ? raw.reason : '';
    if (!VALID_REASONS.has(reason)) {
      throw new Error(
        `Canonicalizer returned invalid rejection reason: ${String(raw.reason)}`,
      );
    }
    return {
      ok: false,
      reason: reason as never,
      message: typeof raw.message === 'string' ? raw.message : 'Rejected.',
    };
  }
  if (raw.ok !== true) {
    throw new Error(`Canonicalizer response missing ok field: ${JSON.stringify(raw)}`);
  }
  const canonicalName = typeof raw.canonicalName === 'string' ? raw.canonicalName.trim() : '';
  const bioSummary = typeof raw.bioSummary === 'string' ? raw.bioSummary.trim() : '';
  const birthYear = typeof raw.birthYear === 'number' ? raw.birthYear : null;
  const deathYear = typeof raw.deathYear === 'number' ? raw.deathYear : null;
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.filter((a): a is string => typeof a === 'string').map((a) => a.trim())
    : [];
  const ticker = typeof raw.suggestedTicker === 'string' ? raw.suggestedTicker.toUpperCase() : '';

  if (!canonicalName) throw new Error('Canonicalizer missing canonicalName');
  if (!bioSummary) throw new Error('Canonicalizer missing bioSummary');
  if (!TICKER_RE.test(ticker)) {
    throw new Error(`Canonicalizer ticker invalid: "${ticker}" (must match ${TICKER_RE})`);
  }

  return {
    ok: true,
    canonicalName,
    bioSummary,
    birthYear,
    deathYear,
    aliases,
    suggestedTicker: ticker,
  };
}

/**
 * Canonicalize a user-provided name into a structured historical-figure
 * record, or reject with a typed reason.
 */
export async function canonicalize(
  rawName: string,
  options: { now?: Date } = {},
): Promise<CanonicalizerResponse> {
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  const rubric = CANONICALIZER_RUBRIC.replace('{{today}}', today);
  const userPrompt =
    `User input: ${JSON.stringify(rawName)}\n\n` +
    `Today's date: ${today}\n\n` +
    `Apply the rubric and return JSON.`;

  const raw = await completeJson<RawCanonResponse>(userPrompt, {
    system: rubric,
    temperature: 0.1,
    maxTokens: 800,
  });
  return validate(raw);
}
