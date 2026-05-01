import { getConfig, networkFromRpcUrl, type SolanaNetwork } from '@metaplex-agent/shared';

/**
 * Server-side helper: the Solana network the server is currently configured
 * to run against, derived from `SOLANA_RPC_URL`. Used to scope all
 * character/mint queries so devnet rows don't collide with mainnet rows
 * even when the same DB backs both deployments.
 */
export function currentNetwork(): SolanaNetwork {
  return networkFromRpcUrl(getConfig().SOLANA_RPC_URL);
}
