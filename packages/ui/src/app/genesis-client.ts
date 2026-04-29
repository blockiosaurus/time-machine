'use client';

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { registerLaunch, type CreateLaunchInput } from '@metaplex-foundation/genesis';
import type { WalletContextState } from '@solana/wallet-adapter-react';

/**
 * Call Genesis's `registerLaunch` from the user's wallet. Required because
 * Genesis API authenticates the HTTP request against `umi.identity`, and
 * the agent NFT is owned by the minter (not the server). The server
 * couldn't make this call.
 *
 * Retries on indexer-lag with exponential backoff, mirroring the server's
 * `createLaunch` retry path.
 */
export async function registerLaunchFromWallet(args: {
  rpcUrl: string;
  wallet: WalletContextState;
  genesisAccount: string;
  createLaunchInput: CreateLaunchInput;
}): Promise<void> {
  if (!args.wallet.publicKey || !args.wallet.signTransaction) {
    throw new Error('Wallet is not connected.');
  }

  const umi = createUmi(args.rpcUrl).use(
    walletAdapterIdentity(args.wallet as never),
  );

  const maxAttempts = 12;
  const baseDelayMs = 1500;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await registerLaunch(umi, {}, {
        genesisAccount: args.genesisAccount,
        createLaunchInput: args.createLaunchInput,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[genesis] client registered launch on attempt ${attempt + 1}: ` +
        `existing=${(result as { existing?: boolean }).existing ?? false}`,
      );
      return;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const isIndexerLag =
        msg.includes('was not found') ||
        msg.includes('not yet indexed') ||
        msg.includes('not found') ||
        msg.includes('genesis account');
      if (!isIndexerLag) throw e;
      lastErr = e;
      const delay = Math.min(baseDelayMs * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
