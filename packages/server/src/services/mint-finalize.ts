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
import { fetchAssetV1 } from '@metaplex-foundation/mpl-core';
import bs58 from 'bs58';
import {
  buildAgentRegistrationDoc,
  buildCharacterMetadataDoc,
  buildCreateCharacterAssetTx,
  buildRegisterIdentityTx,
  buildCreateLaunchInput,
  buildLaunchTransactions,
  getAgentPda,
  getConfig,
  createUmi,
} from '@metaplex-agent/shared';
import { META_PROMPT_VERSION } from '@metaplex-agent/core';
import type { Db } from '../db/index.js';
import { characters, mintJobs } from '../db/schema.js';
import { slugify } from './normalize.js';
import { pinJson, pinBytes } from './irys.js';

interface PreviewState {
  canonicalName: string;
  bioSummary: string;
  birthYear: number | null;
  deathYear: number | null;
  aliases: string[];
  ticker: string;
  slug: string;
  systemPrompt: string;
  promptFingerprint: string;
  metaPromptVersion: string;
  portraitContentType: string;
}

interface UploadedArtefacts {
  promptCid: string;
  portraitCid: string;
  portraitUri: string;
  registrationCid: string;
  characterMetadataCid: string;
  characterMetadataUri: string;
}

function readPreviewState(
  jobRow: typeof mintJobs.$inferSelect,
): PreviewState {
  const steps = jobRow.steps as Record<string, unknown>;
  const preview = steps.preview as PreviewState | undefined;
  if (!preview) {
    throw new Error(`Mint job ${jobRow.id} has no preview state recorded.`);
  }
  return preview;
}

async function loadJob(db: Db, jobId: string, ownerWallet: string) {
  const rows = await db
    .select()
    .from(mintJobs)
    .where(eq(mintJobs.id, jobId))
    .limit(1);
  const job = rows[0];
  if (!job) throw new Error(`Mint job ${jobId} not found`);
  if (job.wallet !== ownerWallet) {
    throw new Error('Owner wallet does not match mint job wallet');
  }
  return job;
}

function resolveMintFeeRecipient(): string {
  const config = getConfig();
  if (config.MINT_FEE_RECIPIENT) return config.MINT_FEE_RECIPIENT;
  const umi = createUmi();
  if (config.AGENT_ASSET_ADDRESS) {
    return getAgentPda(umi, toPublicKey(config.AGENT_ASSET_ADDRESS)).toString();
  }
  return umi.identity.publicKey.toString();
}

async function waitForSignature(sig: string, timeoutMs = 60_000): Promise<void> {
  const umi = createUmi();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tx = await umi.rpc.getTransaction(bs58.decode(sig));
    if (tx) {
      if (tx.meta.err !== null) {
        throw new Error(`Signature ${sig} confirmed with error: ${JSON.stringify(tx.meta.err)}`);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Signature ${sig} did not confirm within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Step A — fee tx
// ---------------------------------------------------------------------------

export interface BuildFeeTxArgs {
  mintJobId: string;
  ownerWallet: string;
}

export interface BuildFeeTxResult {
  feeTx: { id: 'fee'; base64: string };
  mintFeeRecipient: string;
  mintFeeLamports: number;
}

export async function buildFeeTx(
  db: Db,
  args: BuildFeeTxArgs,
): Promise<BuildFeeTxResult> {
  const job = await loadJob(db, args.mintJobId, args.ownerWallet);
  if (job.status === 'failed') {
    throw new Error(`Mint job ${args.mintJobId} is failed.`);
  }

  const config = getConfig();
  const umi = createUmi();
  const userSigner = createNoopSigner(toPublicKey(args.ownerWallet));
  const mintFeeRecipient = resolveMintFeeRecipient();

  const feeBuilder = transferSol(umi, {
    source: userSigner,
    destination: toPublicKey(mintFeeRecipient),
    amount: sol(config.MINT_FEE_LAMPORTS / 1_000_000_000),
  });
  const feeTx = await feeBuilder.setFeePayer(userSigner).buildAndSign(umi);
  const feeBase64 = base64.deserialize(umi.transactions.serialize(feeTx))[0]!;

  await db
    .update(mintJobs)
    .set({ status: 'awaiting_fee', updatedAt: new Date() })
    .where(eq(mintJobs.id, args.mintJobId));

  return {
    feeTx: { id: 'fee', base64: feeBase64 },
    mintFeeRecipient,
    mintFeeLamports: config.MINT_FEE_LAMPORTS,
  };
}

// ---------------------------------------------------------------------------
// Step B — verify fee + run Irys uploads + return create+register tx
// ---------------------------------------------------------------------------

export interface BuildAssetTxArgs {
  mintJobId: string;
  ownerWallet: string;
  feeSignature: string;
  /** Public WS endpoint advertised in the EIP-8004 doc. */
  chatEndpoint: string;
}

export interface BuildAssetTxResult {
  assetAddress: string;
  assetTx: { id: 'create-and-register'; base64: string };
  artefacts: UploadedArtefacts;
}

async function uploadArtefacts(
  db: Db,
  job: typeof mintJobs.$inferSelect,
  preview: PreviewState,
  chatEndpoint: string,
): Promise<UploadedArtefacts> {
  if (!job.portraitBytes) {
    throw new Error('Mint job has no stored portrait bytes; preview must run first.');
  }
  if (!job.promptText) {
    throw new Error('Mint job has no stored prompt text; preview must run first.');
  }

  const [portrait, promptIpfs] = await Promise.all([
    pinBytes(job.portraitBytes, preview.portraitContentType),
    pinJson({
      systemPrompt: job.promptText,
      metaPromptVersion: preview.metaPromptVersion,
      fingerprint: preview.promptFingerprint,
      figure: {
        canonicalName: preview.canonicalName,
        bioSummary: preview.bioSummary,
        birthYear: preview.birthYear,
        deathYear: preview.deathYear,
        aliases: preview.aliases,
      },
    }),
  ]);

  const registrationDoc = buildAgentRegistrationDoc({
    canonicalName: preview.canonicalName,
    bioSummary: preview.bioSummary,
    portraitUri: portrait.uri,
    chatEndpoint,
  });
  const registration = await pinJson(registrationDoc);

  const characterMetadataDoc = buildCharacterMetadataDoc({
    canonicalName: preview.canonicalName,
    slug: preview.slug,
    bioSummary: preview.bioSummary,
    portraitUri: portrait.uri,
    promptCid: promptIpfs.cid,
    portraitCid: portrait.cid,
    registrationCid: registration.cid,
    metaPromptVersion: META_PROMPT_VERSION,
    promptFingerprint: preview.promptFingerprint,
    birthYear: preview.birthYear,
    deathYear: preview.deathYear,
    ticker: preview.ticker,
  });
  const characterMetadata = await pinJson(characterMetadataDoc);

  return {
    promptCid: promptIpfs.cid,
    portraitCid: portrait.cid,
    portraitUri: portrait.uri,
    registrationCid: registration.cid,
    characterMetadataCid: characterMetadata.cid,
    characterMetadataUri: characterMetadata.uri,
  };
}

export async function confirmFeeAndBuildAssetTx(
  db: Db,
  args: BuildAssetTxArgs,
): Promise<BuildAssetTxResult> {
  const job = await loadJob(db, args.mintJobId, args.ownerWallet);
  const preview = readPreviewState(job);
  const config = getConfig();
  if (!config.COLLECTION_ADDRESS) {
    throw new Error('COLLECTION_ADDRESS is not set. Run scripts/create-collection.ts first.');
  }

  // 1. Confirm the fee signature is on-chain. This is what gates the
  //    expensive Irys uploads — without it, abandoned mints could drain the
  //    agent wallet.
  await waitForSignature(args.feeSignature);

  await db
    .update(mintJobs)
    .set({
      status: 'fee_paid',
      feeSignature: args.feeSignature,
      updatedAt: new Date(),
    })
    .where(eq(mintJobs.id, args.mintJobId));

  // 2. Upload artefacts to Irys (paid by agent wallet, reimbursed by the
  //    mint fee that just landed).
  const existingSteps = (job.steps as Record<string, unknown>) ?? {};
  const stepUpdate = {
    ...existingSteps,
    irys_pin: { status: 'running', startedAt: new Date().toISOString() },
  };
  await db
    .update(mintJobs)
    .set({ steps: stepUpdate, updatedAt: new Date() })
    .where(eq(mintJobs.id, args.mintJobId));

  const artefacts = await uploadArtefacts(db, job, preview, args.chatEndpoint);

  // 3. Build the create+register tx, user pays.
  const umi = createUmi();
  const assetSigner = generateSigner(umi);
  const userSigner = createNoopSigner(toPublicKey(args.ownerWallet));

  const { builder: createAssetBuilder } = buildCreateCharacterAssetTx(umi, {
    collection: config.COLLECTION_ADDRESS,
    name: preview.canonicalName,
    metadataUri: artefacts.characterMetadataUri,
    owner: args.ownerWallet,
    assetSigner,
    payer: userSigner,
    authority: umi.identity,
  });
  const registerBuilder = buildRegisterIdentityTx(umi, {
    asset: assetSigner.publicKey,
    collection: config.COLLECTION_ADDRESS,
    agentRegistrationUri: `https://gateway.irys.xyz/${artefacts.registrationCid}`,
    payer: userSigner,
    authority: umi.identity,
  });
  const combined = transactionBuilder().add(createAssetBuilder).add(registerBuilder);
  const combinedTx = await combined.setFeePayer(userSigner).buildAndSign(umi);
  const combinedBase64 = base64.deserialize(umi.transactions.serialize(combinedTx))[0]!;

  await db
    .update(mintJobs)
    .set({
      status: 'awaiting_sig',
      steps: {
        ...existingSteps,
        irys_pin: { status: 'done', completedAt: new Date().toISOString() },
        artefacts,
        nft_mint_address: assetSigner.publicKey.toString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(mintJobs.id, args.mintJobId));

  return {
    assetAddress: assetSigner.publicKey.toString(),
    assetTx: { id: 'create-and-register', base64: combinedBase64 },
    artefacts,
  };
}

// ---------------------------------------------------------------------------
// Step C — verify asset on-chain + build Genesis launch txs
// ---------------------------------------------------------------------------

export interface BuildGenesisArgs {
  mintJobId: string;
  ownerWallet: string;
  /** Signature of the create-and-register tx. */
  assetSignature: string;
}

export interface BuildGenesisResult {
  genesisTokenMint: string;
  genesisAccount: string;
  genesisTxs: Array<{ id: string; base64: string }>;
  /**
   * The exact CreateLaunchInput we passed to Genesis. The client uses this
   * to call registerLaunch from the user's wallet (only the agent owner
   * can authenticate that HTTP call), avoiding the
   * "Agent is not owned by the connected wallet" 403.
   */
  createLaunchInput: ReturnType<typeof buildCreateLaunchInput>;
}

export async function buildGenesisTxs(
  db: Db,
  args: BuildGenesisArgs,
): Promise<BuildGenesisResult> {
  const job = await loadJob(db, args.mintJobId, args.ownerWallet);
  const preview = readPreviewState(job);
  const steps = job.steps as Record<string, unknown>;
  const assetAddress = steps.nft_mint_address as string | undefined;
  const artefacts = steps.artefacts as UploadedArtefacts | undefined;
  if (!assetAddress || !artefacts) {
    throw new Error('Mint job is missing asset/artefact state from build-asset step.');
  }

  // 1. Wait for the asset+register tx to confirm so Genesis SDK can derive
  //    the agent PDA from the on-chain asset.
  await waitForSignature(args.assetSignature);

  const umi = createUmi();
  // Sanity check: the asset must actually exist on-chain (handles Genesis
  // SDK's "AssetV1 not found" error).
  await fetchAssetV1(umi, toPublicKey(assetAddress));

  // 2. Build Genesis launch txs.
  const launchArgs = {
    ownerWallet: args.ownerWallet,
    characterAssetMint: assetAddress,
    tokenName: preview.canonicalName,
    tokenTicker: preview.ticker,
    imageUri: artefacts.portraitUri,
    description: preview.bioSummary,
  };
  const genesisResult = await buildLaunchTransactions(umi, launchArgs);
  const createLaunchInput = buildCreateLaunchInput(launchArgs);

  const genesisTxs: Array<{ id: string; base64: string }> = genesisResult.transactions.map(
    (tx: Transaction, i: number) => {
      const serialized = umi.transactions.serialize(tx);
      return { id: `genesis-${i}`, base64: base64.deserialize(serialized)[0]! };
    },
  );

  await db
    .update(mintJobs)
    .set({
      steps: {
        ...steps,
        asset_signature: args.assetSignature,
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
    genesisTokenMint: genesisResult.mintAddress,
    genesisAccount: genesisResult.genesisAccount,
    genesisTxs,
    createLaunchInput,
  };
}

// ---------------------------------------------------------------------------
// Step D — confirm + insert characters row
// ---------------------------------------------------------------------------

export interface ConfirmArgs {
  mintJobId: string;
  ownerWallet: string;
  /** Genesis tx signatures the client got back after submitting each tx. */
  genesisSignatures: string[];
}

export async function confirmMint(
  db: Db,
  args: ConfirmArgs,
): Promise<{
  slug: string;
  canonicalName: string;
  nftMint: string;
  genesisTokenMint: string;
}> {
  const job = await loadJob(db, args.mintJobId, args.ownerWallet);
  const preview = readPreviewState(job);
  const steps = job.steps as Record<string, unknown>;
  const assetAddr = steps.nft_mint_address as string | undefined;
  const genesisInfo = steps.genesis as
    | { mintAddress?: string; genesisAccount?: string }
    | undefined;
  const artefacts = steps.artefacts as UploadedArtefacts | undefined;
  if (!assetAddr || !genesisInfo?.mintAddress || !artefacts) {
    throw new Error('Mint job is missing finalize artefacts');
  }

  // Confirm Genesis signatures landed.
  for (const sig of args.genesisSignatures) {
    await waitForSignature(sig);
  }

  // Idempotency guard.
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

  // Note: Genesis `registerLaunch` is performed by the client (the user's
  // wallet adapter signs the auth handshake). Genesis API rejects the call
  // unless the connected wallet owns the agent NFT — and the agent NFT is
  // owned by the minter, not the server. The client calls confirm() only
  // after a successful registerLaunch, so reaching this code path means
  // registration succeeded.

  const slug = slugify(preview.canonicalName);
  const normalizedName = preview.canonicalName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  await db.insert(characters).values({
    slug,
    canonicalName: preview.canonicalName,
    normalizedName,
    aliases: preview.aliases ?? [],
    bioSummary: preview.bioSummary ?? '',
    birthYear: preview.birthYear ?? null,
    deathYear: preview.deathYear ?? null,
    systemPrompt: preview.systemPrompt ?? '',
    promptIpfsCid: artefacts.promptCid,
    portraitIpfsCid: artefacts.portraitCid,
    registrationIpfsCid: artefacts.registrationCid,
    nftMint: assetAddr,
    agentRegistryId: assetAddr,
    genesisTokenMint: genesisInfo.mintAddress,
    genesisTicker: preview.ticker ?? 'UNKNOWN',
    ownerWallet: job.wallet,
    status: 'active',
  });

  await db
    .update(mintJobs)
    .set({
      status: 'on_chain',
      // Free up the portrait bytes — it's pinned to Irys now and lives in
      // the characters row via portraitIpfsCid.
      portraitBytes: null,
      updatedAt: new Date(),
    })
    .where(eq(mintJobs.id, args.mintJobId));

  return {
    slug,
    canonicalName: preview.canonicalName,
    nftMint: assetAddr,
    genesisTokenMint: genesisInfo.mintAddress,
  };
}
