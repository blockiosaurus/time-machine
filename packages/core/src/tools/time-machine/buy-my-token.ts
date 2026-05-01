import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  getConfig,
  networkFromRpcUrl,
  ok,
  readAgentContext,
  tokenTradeUrl,
} from '@metaplex-agent/shared';

/**
 * v1: returns a deep-link to the Genesis trading UI. The chat UI presents
 * this as a clickable affordance. v1.5: replace with an in-app
 * swapBondingCurveV2 transaction routed through submitOrSend.
 */
export const buyMyToken = createTool({
  id: 'buy_my_token',
  description:
    "Offer to help the user buy this character's Genesis token. Returns a deep " +
    'link to the Genesis trading UI where they can complete the purchase. ' +
    "Use this when the user expresses interest in buying or when it's natural " +
    'for the character to invite the user to support them.',
  inputSchema: z.object({
    amountSol: z
      .number()
      .finite()
      .positive()
      .max(1000)
      .optional()
      .describe('Optional suggested purchase amount in SOL.'),
  }),
  outputSchema: z.object({
    status: z.string(),
    tradeUrl: z.string().optional(),
    suggestedAmountSol: z.number().optional(),
    message: z.string().optional(),
  }),
  execute: async ({ amountSol }, { requestContext }) => {
    const ctx = readAgentContext(requestContext);
    const character = ctx.character;
    if (!character?.genesisTokenMint) {
      return ok({
        status: 'unavailable',
        message: 'No Genesis token registered for this character yet.',
      });
    }
    const tradeUrl = tokenTradeUrl(
      networkFromRpcUrl(getConfig().SOLANA_RPC_URL),
      character.genesisTokenMint,
    );
    return ok({
      status: 'ok',
      tradeUrl,
      suggestedAmountSol: amountSol,
      message:
        amountSol !== undefined
          ? `Visit the trading page and buy ${amountSol} SOL of $${character.canonicalName ?? 'this'} token.`
          : `Visit the trading page to support ${character.canonicalName ?? 'this character'}.`,
    });
  },
});
