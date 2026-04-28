import { eq } from 'drizzle-orm';
import {
  base64,
  generateSigner,
  publicKey as toPublicKey,
  sol,
  transactionBuilder,
  type Umi,
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
  /** Server-side tx (createCoreAsset + registerIdentityV1) — already on-chain. */
  serverSignature: string;
  /** Address of the newly minted character asset. */
  assetAddress: string;
  /** Address of the Genesis token mint. */
  genesisTokenMint: string;
  /** Genesis launch account PDA. */
  genesisAccount: string;
  /** Transactions for the user to sign + submit, in order. */
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
 * Build & submit the server-side asset+register tx, then build the user-side
 * fee + Genesis launch txs and return them base64-encoded for the client to
 * sign sequentially via their wallet adapter.
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

  // 1. Server-side: build asset + register identity, server is payer + authority.
  const umi = createUmi();
  const assetSigner = generateSigner(umi);

  // Default the mint fee recipient to the agent's PDA wallet (derived from
  // AGENT_ASSET_ADDRESS) so fees accumulate in the agent's controlled
  // account. Fallback to the agent keypair pubkey if the agent isn't yet
  // registered. An explicit MINT_FEE_RECIPIENT env var still wins.
  const mintFeeRecipient =
    config.MINT_FEE_RECIPIENT ??
    (config.AGENT_ASSET_ADDRESS
      ? getAgentPda(umi, toPublicKey(config.AGENT_ASSET_ADDRESS)).toString()
      : umi.identity.publicKey.toString());

  const { builder: createAssetBuilder } = buildCreateCharacterAssetTx(umi, {
    collection: config.COLLECTION_ADDRESS,
    name: preview.canonicalName,
    metadataUri: preview.characterMetadataUri,
    owner: args.ownerWallet,
    assetSigner,
  });
  const registerBuilder = buildRegisterIdentityTx(umi, {
    asset: assetSigner.publicKey,
    collection: config.COLLECTION_ADDRESS,
    agentRegistrationUri: `https://gateway.irys.xyz/${preview.registrationCid}`,
  });

  const combined = transactionBuilder()
    .add(createAssetBuilder)
    .add(registerBuilder);

  // Submit server-side tx and confirm. Persist intermediate state before
  // calling Genesis so a Genesis-build failure doesn't lose the asset.
  const serverConfirm = await combined.sendAndConfirm(umi);
  const serverSignature = bs58.encode(serverConfirm.signature);

  await db
    .update(mintJobs)
    .set({
      steps: {
        ...(job.steps as Record<string, unknown>),
        nft_mint: { status: 'done', completedAt: new Date().toISOString() },
        registry: { status: 'done', completedAt: new Date().toISOString() },
        nft_mint_address: assetSigner.publicKey.toString(),
        server_tx_signature: serverSignature,
      },
      updatedAt: new Date(),
    })
    .where(eq(mintJobs.id, args.mintJobId));

  // 2. User-side: fee transfer + Genesis launch.
  const userSigner = createNoopSigner(toPublicKey(args.ownerWallet));
  const feeBuilder = transferSol(umi, {
    source: userSigner,
    destination: toPublicKey(mintFeeRecipient),
    amount: sol(config.MINT_FEE_LAMPORTS / 1_000_000_000),
  });

  // Build the fee tx; user will sign as fee payer.
  const feeTx = await feeBuilder.setFeePayer(userSigner).buildAndSign(umi);
  const feeBase64 = base64.deserialize(umi.transactions.serialize(feeTx))[0]!;

  // 3. Genesis launch — must run after the asset is on-chain (above sendAndConfirm).
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
      return {
        id: `genesis-${i}`,
        base64: base64.deserialize(serialized)[0]!,
      };
    },
  );

  await db
    .update(mintJobs)
    .set({
      steps: {
        ...(job.steps as Record<string, unknown>),
        genesis: {
          status: 'pending_user_sigs',
          mintAddress: genesisResult.mintAddress,
          genesisAccount: genesisResult.genesisAccount,
        },
        nft_mint: { status: 'done', completedAt: new Date().toISOString() },
        registry: { status: 'done', completedAt: new Date().toISOString() },
        nft_mint_address: assetSigner.publicKey.toString(),
        server_tx_signature: serverSignature,
      },
      updatedAt: new Date(),
    })
    .where(eq(mintJobs.id, args.mintJobId));

  return {
    serverSignature,
    assetAddress: assetSigner.publicKey.toString(),
    genesisTokenMint: genesisResult.mintAddress,
    genesisAccount: genesisResult.genesisAccount,
    userTransactions: [{ id: 'fee', base64: feeBase64 }, ...genesisTxs],
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
