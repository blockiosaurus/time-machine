import {
  publicKey as toPublicKey,
  type Umi,
  type PublicKey,
} from '@metaplex-foundation/umi';
import { findAssociatedTokenPda, fetchToken } from '@metaplex-foundation/mpl-toolbox';
import bs58 from 'bs58';

export interface AccessCheckResult {
  allowed: boolean;
  reason?: 'owner' | 'token_holder' | 'denied';
  tokenBalance?: bigint;
}

/**
 * Decide whether a wallet may chat with a character. Allowed if:
 *   - the wallet is the cached NFT owner, OR
 *   - the wallet holds any positive amount of the character's Genesis token.
 *
 * The owner check uses the cached `ownerWallet` value (refreshed on each
 * mint). The token-holder check reads the wallet's associated token account
 * for the character's Genesis mint. We don't sweep all token accounts —
 * the ATA is the standard location, and that's where Phantom / Genesis UI
 * deposit on a buy.
 */
export async function checkCharacterAccess(
  umi: Umi,
  args: {
    wallet: string;
    ownerWallet: string;
    genesisTokenMint: string;
  },
): Promise<AccessCheckResult> {
  if (args.wallet === args.ownerWallet) {
    return { allowed: true, reason: 'owner' };
  }

  const owner: PublicKey = toPublicKey(args.wallet);
  const mint: PublicKey = toPublicKey(args.genesisTokenMint);
  const ata = findAssociatedTokenPda(umi, { mint, owner })[0];
  try {
    const token = await fetchToken(umi, ata);
    if (token.amount > 0n) {
      return { allowed: true, reason: 'token_holder', tokenBalance: token.amount };
    }
  } catch {
    // No ATA exists for this wallet+mint; treated as zero balance.
  }
  return { allowed: false, reason: 'denied' };
}

/**
 * Verify that `signatureBase58` is a valid ed25519 signature of the bytes
 * `message` produced by the secret key matching `walletBase58`. Throws on
 * malformed input; returns false on signature mismatch.
 */
export function verifyWalletSignature(
  umi: Umi,
  walletBase58: string,
  message: Uint8Array,
  signatureBase58: string,
): boolean {
  const pubkey = toPublicKey(walletBase58);
  const signature = bs58.decode(signatureBase58);
  if (signature.length !== 64) return false;
  return umi.eddsa.verify(message, signature, pubkey);
}
