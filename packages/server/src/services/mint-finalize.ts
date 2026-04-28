import { eq } from 'drizzle-orm';
import {
  base64,
  generateSigner,
  publicKey as toPublicKey,
  sol,
  transactionBuilder,
  type Transaction,
  createNoopSigner,
} from '@metaplex-foundation/umi';
import { transferSol } from '@metaplex-foundation/mpl-toolbox';
import bs58 from 'bs58';
import {
  buildCreateCharacterAssetTx,
  buildRegisterIdentityTx,
  buildLaunchTransactions,
  registerCharacterTokenLaunch,
  getAgentPda,
  getConfig,
  createUmi,
} from '@metaplex-agent/shared';
import type { Db } from '../db/index.js';
import { characters, mintJobs } from '../db/schema.js';
import { slugify } from './normalize.js';

export interface FinalizeArgs {
  mintJobId: string;
  ownerWallet: string;
}

export interface FinalizeResult {
  /** Address of the asset that will be minted by the user's first tx. */
  assetAddress: string;
  /** Address of the Genesis token mint. */
  genesisTokenMint: string;
  /** Genesis launch account PDA. */
  genesisAccount: string;
  /**
   * Transactions for the user to sign + submit, in order. Order matters:
   * fee → create-and-register → genesis launches.
   */
  userTransactions: Array<{ id: string; base64: string }>;
}

interface PreviewState {
  canonicalName: string;
  bioSummary: string;
  birthYear: number | null;
  deathYear: number | null;
  aliases: string[];
  ticker: string;
  promptCid: string;
  portraitCid: string;
  registrationCid: string;
  characterMetadataCid: string;
  characterMetadataUri: string;
  systemPrompt: string;
  promptFingerprint: string;
  metaPromptVersion: string;
}

/**
 * Pull preview state out of the mint_job. Throws if the job is not in
 * awaiting_sig state or if any required artefact is missing.
 */
function readPreviewState(jobRow: typeof mintJobs.$inferSelect): PreviewState {
  if (jobRow.status !== 'awaiting_sig') {
    throw new Error(
      `Mint job ${jobRow.id} is in state "${jobRow.status}" (need "awaiting_sig").`,
    );
  }
  const steps = jobRow.steps as Record<string, unknown>;
  const preview = steps.preview as PreviewState | undefined;
  if (!preview) {
    throw new Error(`Mint job ${jobRow.id} has no preview state recorded.`);
  }
  return preview;
}

/**
 * Build the four (or more) transactions the user signs to mint a character.
 * Server pre-signs the asset + authority slots; everything else lands on the
 * minter's wallet so the platform pays nothing for asset rent.
 *
 * Order:
 *   1. fee                   — 0.25 SOL → MINT_FEE_RECIPIENT (or agent PDA)
 *   2. create-and-register   — createV2 + registerIdentityV1, user is payer
 *                              + asset owner; server pre-signs as
 *                              assetSigner + asset authority
 *   3..N. genesis-launches   — bonding-curve setup, user is `wallet`
 */
export async function finalizeMint(
  db: Db,
  args: FinalizeArgs,
): Promise<FinalizeResult> {
  const config = getConfig();
  if (!config.COLLECTION_ADDRESS) {
    throw new Error(
      'COLLECTION_ADDRESS is not set. Run scripts/create-collection.ts first.',
    );
  }

  const rows = await db
    .select()
    .from(mintJobs)
    .where(eq(mintJobs.id, args.mintJobId))
    .limit(1);
  const job = rows[0];
  if (!job) throw new Error(`Mint job ${args.mintJobId} not found`);
  if (job.wallet !== args.ownerWallet) {
    throw new Error('Owner wallet does not match mint job wallet');
  }
  const preview = readPreviewState(job);

  const umi = createUmi();
  const assetSigner = generateSigner(umi);
  const userSigner = createNoopSigner(toPublicKey(args.ownerWallet));

  // Mint fee recipient: env override > agent PDA > raw agent keypair.
  const mintFeeRecipient =
    config.MINT_FEE_RECIPIENT ??
    (config.AGENT_ASSET_ADDRESS
      ? getAgentPda(umi, toPublicKey(config.AGENT_ASSET_ADDRESS)).toString()
      : umi.identity.publicKey.toString());

  // (1) Fee transfer — user pays, user signs.
  const feeBuilder = transferSol(umi, {
    source: userSigner,
    destination: toPublicKey(mintFeeRecipient),
    amount: sol(config.MINT_FEE_LAMPORTS / 1_000_000_000),
  });
  const feeTx = await feeBuilder.setFeePayer(userSigner).buildAndSign(umi);
  const feeBase64 = base64.deserialize(umi.transactions.serialize(feeTx))[0]!;

  // (2) Create + register, user pays. Server pre-signs as assetSigner +
  // asset authority. The user's wallet (Phantom etc.) fills in the payer
  // signature when it signs the partially-signed tx we return.
  const { builder: createAssetBuilder } = buildCreateCharacterAssetTx(umi, {
    collection: config.COLLECTION_ADDRESS,
    name: preview.canonicalName,
    metadataUri: preview.characterMetadataUri,
    owner: args.ownerWallet,
    assetSigner,
    payer: userSigner,
    authority: umi.identity, // server keypair retains update authority
  });
  const registerBuilder = buildRegisterIdentityTx(umi, {
    asset: assetSigner.publicKey,
    collection: config.COLLECTION_ADDRESS,
    agentRegistrationUri: `https://gateway.irys.xyz/${preview.registrationCid}`,
    payer: userSigner,
    authority: umi.identity, // server keypair (must match asset's update authority)
  });
  const combined = transactionBuilder()
    .add(createAssetBuilder)
    .add(registerBuilder);
  const combinedTx = await combined.setFeePayer(userSigner).buildAndSign(umi);
  const combinedBase64 = base64.deserialize(umi.transactions.serialize(combinedTx))[0]!;

  // (3..N) Genesis launch. createLaunch builds unsigned txs that reference
  // the future asset pubkey; the user signs each as `wallet` and submits.
  const genesisResult = await buildLaunchTransactions(umi, {
    ownerWallet: args.ownerWallet,
    characterAssetMint: assetSigner.publicKey,
    tokenName: preview.canonicalName,
    tokenTicker: preview.ticker,
    imageUri: `https://gateway.irys.xyz/${preview.portraitCid}`,
    description: preview.bioSummary,
  });
  const genesisTxs: Array<{ id: string; base64: string }> = genesisResult.transactions.map(
    (tx: Transaction, i: number) => {
      const serialized = umi.transactions.serialize(tx);
      return { id: `genesis-${i}`, base64: base64.deserialize(serialized)[0]! };
    },
  );

  // Persist intermediate state so /confirm can stitch everything together
  // even if the client retries or fails mid-flight.
  await db
    .update(mintJobs)
    .set({
      steps: {
        ...(job.steps as Record<string, unknown>),
        nft_mint_address: assetSigner.publicKey.toString(),
        genesis: {
          status: 'pending_user_sigs',
          mintAddress: genesisResult.mintAddress,
          genesisAccount: genesisResult.genesisAccount,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(mintJobs.id, args.mintJobId));

  return {
    assetAddress: assetSigner.publicKey.toString(),
    genesisTokenMint: genesisResult.mintAddress,
    genesisAccount: genesisResult.genesisAccount,
    userTransactions: [
      { id: 'fee', base64: feeBase64 },
      { id: 'create-and-register', base64: combinedBase64 },
      ...genesisTxs,
    ],
  };
}

export interface ConfirmArgs {
  mintJobId: string;
  /** Signatures the client got back after submitting each user transaction. */
  signatures: string[];
}

/**
 * Verify the user's transactions confirmed on-chain, then upsert the
 * characters row. Idempotent: if the character row already exists for
 * this mint_job, returns it without re-inserting.
 */
export async function confirmMint(db: Db, args: ConfirmArgs): Promise<{
  slug: string;
  canonicalName: string;
  nftMint: string;
  genesisTokenMint: string;
}> {
  const rows = await db
    .select()
    .from(mintJobs)
    .where(eq(mintJobs.id, args.mintJobId))
    .limit(1);
  const job = rows[0];
  if (!job) throw new Error(`Mint job ${args.mintJobId} not found`);
  const steps = job.steps as Record<string, unknown>;
  const assetAddr = steps.nft_mint_address as string | undefined;
  const genesisInfo = steps.genesis as
    | { mintAddress?: string; genesisAccount?: string }
    | undefined;
  const previewState = steps.preview as
    | { canonicalName?: string; ticker?: string; promptCid?: string;
        portraitCid?: string; registrationCid?: string;
        bioSummary?: string; aliases?: string[];
        birthYear?: number | null; deathYear?: number | null;
        systemPrompt?: string;
      }
    | undefined;
  if (!assetAddr || !genesisInfo?.mintAddress || !previewState?.canonicalName) {
    throw new Error('Mint job is missing finalize artefacts');
  }

  // Confirm signatures landed.
  const umi = createUmi();
  for (const sig of args.signatures) {
    const status = await umi.rpc.getTransaction(bs58.decode(sig));
    if (!status || status.meta.err !== null) {
      throw new Error(`Signature ${sig} did not confirm successfully`);
    }
  }

  // Register the launch with Genesis (signaling that creation succeeded).
  // Skipped silently if registerLaunch is idempotent and was already run.
  if (genesisInfo.genesisAccount) {
    try {
      await registerCharacterTokenLaunch(umi, {
        genesisAccount: genesisInfo.genesisAccount,
        ownerWallet: job.wallet,
        characterAssetMint: assetAddr,
        tokenName: previewState.canonicalName,
        tokenTicker: previewState.ticker ?? 'UNKNOWN',
        imageUri: `https://gateway.irys.xyz/${previewState.portraitCid ?? ''}`,
        description: previewState.bioSummary ?? '',
      });
    } catch (e) {
      // Non-fatal — Genesis registration is a service-side acknowledgement;
      // the on-chain launch already exists. Log and continue.
      console.warn('registerCharacterTokenLaunch failed (non-fatal):', (e as Error).message);
    }
  }

  // Idempotency: check if already inserted.
  const existing = await db
    .select()
    .from(characters)
    .where(eq(characters.nftMint, assetAddr))
    .limit(1);
  if (existing[0]) {
    return {
      slug: existing[0].slug,
      canonicalName: existing[0].canonicalName,
      nftMint: existing[0].nftMint,
      genesisTokenMint: existing[0].genesisTokenMint,
    };
  }

  const slug = slugify(previewState.canonicalName);
  const normalizedName = previewState.canonicalName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  await db.insert(characters).values({
    slug,
    canonicalName: previewState.canonicalName,
    normalizedName,
    aliases: previewState.aliases ?? [],
    bioSummary: previewState.bioSummary ?? '',
    birthYear: previewState.birthYear ?? null,
    deathYear: previewState.deathYear ?? null,
    systemPrompt: previewState.systemPrompt ?? '',
    promptIpfsCid: previewState.promptCid ?? '',
    portraitIpfsCid: previewState.portraitCid ?? '',
    registrationIpfsCid: previewState.registrationCid ?? '',
    nftMint: assetAddr,
    agentRegistryId: assetAddr, // Identity PDA derives from asset; same address is fine for lookup
    genesisTokenMint: genesisInfo.mintAddress,
    genesisTicker: previewState.ticker ?? 'UNKNOWN',
    ownerWallet: job.wallet,
    status: 'active',
  });

  await db
    .update(mintJobs)
    .set({ status: 'on_chain', updatedAt: new Date() })
    .where(eq(mintJobs.id, args.mintJobId));

  return {
    slug,
    canonicalName: previewState.canonicalName,
    nftMint: assetAddr,
    genesisTokenMint: genesisInfo.mintAddress,
  };
}
