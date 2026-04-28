/**
 * Provider-agnostic utility-LLM client. The chat agent uses Mastra's Agent
 * class (which dispatches via the AI SDK), but mint-time helpers
 * (canonicalize, prompt-gen, moderation) are one-shot calls that don't
 * benefit from agent overhead — so we call provider SDKs directly here and
 * dispatch based on `LLM_MODEL`'s `provider/model-id` prefix.
 *
 * Supports `anthropic/...` and `openai/...`. Falls back to Anthropic when
 * no prefix is present so existing prompts keep working.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getConfig } from '@metaplex-agent/shared';

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function anthropicClient(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is required when LLM_MODEL uses an anthropic/ model.',
    );
  }
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

function openaiClient(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required when LLM_MODEL uses an openai/ model.',
    );
  }
  _openai = new OpenAI({ apiKey });
  return _openai;
}

interface ParsedModel {
  provider: 'anthropic' | 'openai';
  modelId: string;
}

function parseModel(): ParsedModel {
  const raw = getConfig().LLM_MODEL;
  const slashIdx = raw.indexOf('/');
  const provider = (slashIdx >= 0 ? raw.slice(0, slashIdx) : 'anthropic').toLowerCase();
  const modelId = slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw;
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(
      `Unsupported LLM provider for utility calls: "${provider}". ` +
      'Time Machine utility services support anthropic/ and openai/ models. ' +
      'Set LLM_MODEL to e.g. "anthropic/claude-haiku-4-5-20251001" or "openai/gpt-4o-mini".',
    );
  }
  return { provider, modelId };
}

export interface CallOptions {
  system?: string;
  /** If true, prepend a "JSON only" instruction. */
  jsonOnly?: boolean;
  maxTokens?: number;
  temperature?: number;
}

const JSON_ONLY_SYSTEM =
  'You output a single JSON object and nothing else. No prose, no code fences.';

/**
 * One-shot text completion via whichever provider LLM_MODEL points at.
 * Returns the concatenated text content.
 */
export async function complete(
  userPrompt: string,
  opts: CallOptions = {},
): Promise<string> {
  const { provider, modelId } = parseModel();
  const system = opts.system ?? (opts.jsonOnly ? JSON_ONLY_SYSTEM : undefined);
  const maxTokens = opts.maxTokens ?? 1500;
  const temperature = opts.temperature ?? 0.2;

  if (provider === 'anthropic') {
    const resp = await anthropicClient().messages.create({
      model: modelId,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    });
    return resp.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
  }

  // openai
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: userPrompt });

  const resp = await openaiClient().chat.completions.create({
    model: modelId,
    max_tokens: maxTokens,
    temperature,
    messages,
    ...(opts.jsonOnly ? { response_format: { type: 'json_object' as const } } : {}),
  });
  return resp.choices[0]?.message?.content ?? '';
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
  } catch {
    throw new Error(
      `Failed to parse JSON from utility model. Raw: ${text.slice(0, 500)}`,
    );
  }
}
