import {
  createLaunch,
  registerLaunch,
  type CreateLaunchInput,
  type CreateLaunchResponse,
  type RegisterLaunchResponse,
  type TokenMetadata,
} from '@metaplex-foundation/genesis';
import { type Umi, type PublicKey } from '@metaplex-foundation/umi';

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

export function buildCreateLaunchInput(args: LaunchCharacterTokenArgs): CreateLaunchInput {
  return {
    wallet: args.ownerWallet,
    token: buildTokenMetadata(args),
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
 * Returns unsigned transactions for the user wallet to sign + submit. Call
 * `registerCharacterTokenLaunch` after on-chain confirmation to finish
 * registration.
 */
export async function buildLaunchTransactions(
  umi: Umi,
  args: LaunchCharacterTokenArgs,
): Promise<CreateLaunchResponse> {
  return await createLaunch(umi, {}, buildCreateLaunchInput(args));
}

export async function registerCharacterTokenLaunch(
  umi: Umi,
  args: LaunchCharacterTokenArgs & { genesisAccount: string },
): Promise<RegisterLaunchResponse> {
  return await registerLaunch(umi, {}, {
    genesisAccount: args.genesisAccount,
    createLaunchInput: buildCreateLaunchInput(args),
  });
}
