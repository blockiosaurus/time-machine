import {
  createLaunch,
  registerLaunch,
  type CreateLaunchInput,
  type CreateLaunchResponse,
  type RegisterLaunchResponse,
  type SvmNetwork,
  type TokenMetadata,
} from '@metaplex-foundation/genesis';
import { type Umi, type PublicKey } from '@metaplex-foundation/umi';
import { getConfig } from '../config.js';
import { networkFromRpcUrl } from './links.js';

export interface LaunchCharacterTokenArgs {
  /** Wallet that will sign the launch transactions (the NFT minter). */
  ownerWallet: PublicKey | string;
  /** Character NFT (Core asset) address — wires fees to the agent PDA. */
  characterAssetMint: PublicKey | string;
  /** Token name (canonical character name). */
  tokenName: string;
  /** Ticker; 3-10 uppercase A-Z. */
  tokenTicker: string;
  /** Irys gateway URL of portrait — Genesis requires gateway.irys.xyz prefix. */
  imageUri: string;
  /** Short description, max 250 chars (Genesis limit). */
  description?: string;
}

const IRYS_GATEWAY_PREFIX = 'https://gateway.irys.xyz/';

function ensureIrysImage(uri: string): string {
  if (!uri.startsWith(IRYS_GATEWAY_PREFIX)) {
    throw new Error(
      `Genesis requires Irys-hosted images. Got: ${uri}. Prefix must be ${IRYS_GATEWAY_PREFIX}`,
    );
  }
  return uri;
}

export function buildTokenMetadata(args: LaunchCharacterTokenArgs): TokenMetadata {
  return {
    name: args.tokenName.slice(0, 32),
    symbol: args.tokenTicker,
    image: ensureIrysImage(args.imageUri),
    description: args.description?.slice(0, 250),
  };
}

/**
 * Pick the Genesis API network from SOLANA_RPC_URL — devnet/testnet RPCs
 * route to `solana-devnet`, everything else to `solana-mainnet`. Without
 * this Genesis defaults to mainnet and its indexer never finds devnet
 * assets, regardless of how many times we retry.
 */
function pickGenesisNetwork(): SvmNetwork {
  const network = networkFromRpcUrl(getConfig().SOLANA_RPC_URL);
  return network === 'mainnet' ? 'solana-mainnet' : 'solana-devnet';
}

export function buildCreateLaunchInput(args: LaunchCharacterTokenArgs): CreateLaunchInput {
  return {
    wallet: args.ownerWallet,
    token: buildTokenMetadata(args),
    network: pickGenesisNetwork(),
    launchType: 'bondingCurve',
    launch: {
      // Disable mandatory first-buy — keeps mint UX clean.
      firstBuyAmount: 0,
    },
    agent: {
      mint: args.characterAssetMint,
      setToken: true,
    },
  };
}

/**
 * Time Machine launches every character token via Genesis bonding curve.
 *
 * - 100% of creator fees flow to the NFT owner via Genesis's default
 *   creatorFeeWallet behavior when `agent.mint` is supplied — the fees go
 *   to the agent PDA, which is owned by the NFT owner.
 * - We rely on Genesis protocol defaults for supply splits, virtual amounts,
 *   and fund flows.
 *
 * Genesis runs its own indexer; even after the asset is confirmed on the
 * user's RPC, Genesis's API may not see it for several seconds. We retry
 * the "AssetV1 not found" path with exponential backoff before giving up.
 *
 * Returns unsigned transactions for the user wallet to sign + submit. Call
 * `registerCharacterTokenLaunch` after on-chain confirmation to finish
 * registration.
 */
export async function buildLaunchTransactions(
  umi: Umi,
  args: LaunchCharacterTokenArgs,
): Promise<CreateLaunchResponse> {
  const input = buildCreateLaunchInput(args);
  const maxAttempts = 12;
  const baseDelayMs = 1500;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await createLaunch(umi, {}, input);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const isIndexerLag =
        msg.includes('AssetV1') && msg.includes('was not found');
      if (!isIndexerLag) throw e;
      lastErr = e;
      const delay = Math.min(baseDelayMs * 2 ** attempt, 8000);
      console.warn(
        `[genesis] indexer lag on attempt ${attempt + 1}/${maxAttempts}; ` +
        `retrying in ${delay}ms (asset ${args.characterAssetMint})`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Acknowledge the on-chain launch with Genesis's backend so it appears in
 * the Genesis UI, the indexer, and any Slack notifications they wire up.
 * Same indexer-lag retry pattern as createLaunch.
 */
export async function registerCharacterTokenLaunch(
  umi: Umi,
  args: LaunchCharacterTokenArgs & { genesisAccount: string },
): Promise<RegisterLaunchResponse> {
  const input = {
    genesisAccount: args.genesisAccount,
    createLaunchInput: buildCreateLaunchInput(args),
  };
  const maxAttempts = 12;
  const baseDelayMs = 1500;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await registerLaunch(umi, {}, input);
      console.log(
        `[genesis] registered launch on attempt ${attempt + 1}: ` +
        `genesisAccount=${args.genesisAccount} mint=${args.characterAssetMint} ` +
        `existing=${result.existing ?? false}`,
      );
      return result;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      // Genesis API returns "AssetV1 was not found" or similar when its
      // indexer hasn't caught up to the on-chain create txs yet.
      const isIndexerLag =
        msg.includes('was not found') ||
        msg.includes('not yet indexed') ||
        msg.includes('not found') ||
        msg.includes('genesis account');
      if (!isIndexerLag) {
        console.error('[genesis] registerLaunch failed (non-retryable):', e);
        throw e;
      }
      lastErr = e;
      const delay = Math.min(baseDelayMs * 2 ** attempt, 8000);
      console.warn(
        `[genesis] registerLaunch indexer lag on attempt ${attempt + 1}/${maxAttempts}; ` +
        `retrying in ${delay}ms (genesisAccount ${args.genesisAccount})`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
