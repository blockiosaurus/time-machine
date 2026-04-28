import { Agent } from '@mastra/core/agent';
import { getConfig, type CharacterRow } from '@metaplex-agent/shared';
import { timeMachineChatTools } from '../tools/time-machine/index.js';

/**
 * Build a Mastra agent for a single historical-figure character.
 *
 * - Uses the character's own AI-generated system prompt verbatim.
 * - Tools are limited to the chat-only set (token info + buy deep-link).
 *   Solana transfer/swap tools are intentionally NOT included; characters
 *   should not be moving the user's funds around.
 * - Each WebSocket session creates one of these. They are cheap to construct.
 * - Uses the same `LLM_MODEL` as the template's default agent.
 */
export function createHistoricalFigureAgent(character: CharacterRow): Agent {
  const config = getConfig();
  return new Agent({
    id: `time-machine-${character.slug}`,
    name: character.canonicalName,
    instructions: character.systemPrompt,
    model: config.LLM_MODEL,
    tools: timeMachineChatTools as unknown as Record<string, never>,
  });
}
