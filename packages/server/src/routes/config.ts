import type { IncomingMessage, ServerResponse } from 'node:http';
import { getConfig } from '@metaplex-agent/shared';
import { currentNetwork } from '../services/network.js';
import { sendJson } from './http-utils.js';

/**
 * GET /api/config — exposes server-side configuration values the UI needs
 * to render correctly without hardcoding them. Keep this strictly public-
 * safe: never include API keys, wallet secrets, or DB URLs.
 */
export async function handleGetConfig(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const cfg = getConfig();
  sendJson(res, 200, {
    network: currentNetwork(),
    mintFeeLamports: cfg.MINT_FEE_LAMPORTS,
    mintFeeRecipient: cfg.MINT_FEE_RECIPIENT ?? null,
    collectionAddress: cfg.COLLECTION_ADDRESS ?? null,
    publicBaseUrl: cfg.PUBLIC_BASE_URL,
  });
}
