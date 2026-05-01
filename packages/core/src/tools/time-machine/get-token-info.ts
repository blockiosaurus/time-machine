import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  getConfig,
  networkFromRpcUrl,
  ok,
  readAgentContext,
  tokenTradeUrl,
} from '@metaplex-agent/shared';

export const getTokenInfo = createTool({
  id: 'get_token_info',
  description:
    "Return basic info about this character's Genesis token: name, ticker, mint address, " +
    "and a deep link to the Genesis trading UI where users can view live price and trade.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    status: z.string(),
    token: z
      .object({
        name: z.string(),
        ticker: z.string(),
        mint: z.string(),
        tradeUrl: z.string(),
      })
      .optional(),
    message: z.string().optional(),
  }),
  execute: async (_args, { requestContext }) => {
    const ctx = readAgentContext(requestContext);
    const character = ctx.character;
    if (!character?.genesisTokenMint) {
      return ok({
        status: 'unavailable',
        message: 'No Genesis token registered for this character.',
      });
    }
    const tradeUrl = tokenTradeUrl(
      networkFromRpcUrl(getConfig().SOLANA_RPC_URL),
      character.genesisTokenMint,
    );
    return ok({
      status: 'ok',
      token: {
        name: character.canonicalName ?? 'unknown',
        ticker: character.genesisTicker ?? 'UNKNOWN',
        mint: character.genesisTokenMint,
        tradeUrl,
      },
    });
  },
});
