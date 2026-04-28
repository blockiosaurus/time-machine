import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is required for Time Machine utility LLM calls (canonicalize, prompt-gen, moderation).',
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

/** Utility model — Haiku 4.5 for cheap one-shot work. */
export const UTILITY_MODEL = 'claude-haiku-4-5-20251001';

/** Chat model — Sonnet 4.6 for in-character conversations. */
export const CHAT_MODEL = 'claude-sonnet-4-6';

export interface CallOptions {
  system?: string;
  /** If true, prepend a "JSON only" instruction and parse the response. */
  jsonOnly?: boolean;
  maxTokens?: number;
  temperature?: number;
}

/**
 * One-shot text completion. Returns the raw text content (concatenated
 * across blocks). For JSON-mode responses, callers should pass
 * `jsonOnly: true` and JSON.parse the output themselves (we don't parse
 * here so callers can attach typed schemas).
 */
export async function complete(
  userPrompt: string,
  opts: CallOptions = {},
): Promise<string> {
  const client = getClient();
  const system = opts.system ??
    (opts.jsonOnly
      ? 'You output a single JSON object and nothing else. No prose, no code fences.'
      : undefined);

  const resp = await client.messages.create({
    model: UTILITY_MODEL,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.2,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');
}

/**
 * One-shot JSON completion. Returns parsed JSON or throws if parsing fails.
 * Caller is responsible for runtime-validating the shape.
 */
export async function completeJson<T = unknown>(
  userPrompt: string,
  opts: Omit<CallOptions, 'jsonOnly'> = {},
): Promise<T> {
  const text = await complete(userPrompt, { ...opts, jsonOnly: true });
  // Tolerate accidental code fences if the model adds them.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from utility model. Raw: ${text.slice(0, 500)}`,
    );
  }
}
