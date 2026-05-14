/**
 * Pure helpers for building Metaplex links. Kept import-free so the UI can
 * pull just these without dragging in server-only deps (umi, getConfig,
 * Anthropic SDK, etc.) at bundle time.
 */

export type SolanaNetwork = 'mainnet' | 'devnet' | 'testnet';

/**
 * Infer the Solana network from an RPC URL. Looks for the substrings
 * "devnet" or "testnet" in the URL; everything else is treated as mainnet.
 * Works for the canonical RPCs (`api.devnet.solana.com`,
 * `api.mainnet-beta.solana.com`) and Helius/QuickNode/Triton URLs that
 * embed the network in the host (`mainnet.helius-rpc.com`).
 */
export function networkFromRpcUrl(rpcUrl: string): SolanaNetwork {
  const lower = rpcUrl.toLowerCase();
  if (lower.includes('devnet')) return 'devnet';
  if (lower.includes('testnet')) return 'testnet';
  return 'mainnet';
}

/**
 * Build the metaplex.com token trading URL. Mainnet is the default so the
 * `network` query param is omitted; devnet/testnet append it.
 */
export function tokenTradeUrl(network: SolanaNetwork, mint: string): string {
  const base = `https://www.metaplex.com/token/${mint}`;
  if (network === 'mainnet') return base;
  return `${base}?network=solana-${network}`;
}

/**
 * Build the Irys gateway URL for a given upload CID. Mainnet uploads serve
 * from `gateway.irys.xyz`; devnet/testnet uploads serve from
 * `devnet.irys.xyz`. Requesting a devnet CID from the mainnet gateway
 * returns 404, which is the usual cause of "portraits aren't showing up"
 * after a devnet mint.
 */
export function irysGatewayUrl(network: SolanaNetwork, cid: string): string {
  const host = network === 'mainnet' ? 'gateway.irys.xyz' : 'devnet.irys.xyz';
  return `https://${host}/${cid}`;
}

/**
 * Returns true if `uri` is a valid Irys gateway URL for the given network.
 * Used by Genesis token-metadata validation, which is strict about hosts.
 */
export function isValidIrysGateway(network: SolanaNetwork, uri: string): boolean {
  const expectedHost = network === 'mainnet' ? 'gateway.irys.xyz' : 'devnet.irys.xyz';
  return uri.startsWith(`https://${expectedHost}/`);
}
