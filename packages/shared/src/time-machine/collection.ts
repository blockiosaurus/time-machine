import {
  create as createCoreAsset,
  createCollection as createCoreCollection,
  type AssetV1,
} from '@metaplex-foundation/mpl-core';
import {
  generateSigner,
  publicKey as toPublicKey,
  type Umi,
  type PublicKey,
  type Signer,
  type TransactionBuilder,
} from '@metaplex-foundation/umi';

export const TIME_MACHINE_COLLECTION_NAME = 'Time Machine';
export const TIME_MACHINE_COLLECTION_SYMBOL = 'TIME';

export interface BootstrapCollectionArgs {
  /** URI of a JSON metadata blob describing the collection (pinned to Irys). */
  metadataUri: string;
  /** Authority that owns the collection. Defaults to umi.identity. */
  updateAuthority?: PublicKey | string;
}

/**
 * Build a TransactionBuilder that creates the "Time Machine" Core collection.
 * Run this ONCE at deploy time via scripts/create-collection.ts; persist the
 * resulting collection address into COLLECTION_ADDRESS env var.
 */
export function buildCreateCollectionTx(
  umi: Umi,
  args: BootstrapCollectionArgs,
): { builder: TransactionBuilder; collectionSigner: Signer } {
  const collection = generateSigner(umi);
  const builder = createCoreCollection(umi, {
    collection,
    name: TIME_MACHINE_COLLECTION_NAME,
    uri: args.metadataUri,
    updateAuthority: args.updateAuthority
      ? toPublicKey(args.updateAuthority)
      : undefined,
  });
  return { builder, collectionSigner: collection };
}

export interface CreateCharacterAssetArgs {
  /** The Time Machine collection (set via COLLECTION_ADDRESS). */
  collection: PublicKey | string;
  /** Display name of the character asset. */
  name: string;
  /** Irys URI of the character metadata JSON (prompt CID + portrait CID + bio). */
  metadataUri: string;
  /** The wallet that will own the character NFT. */
  owner: PublicKey | string;
  /** Optional custom asset signer; defaults to a fresh generateSigner(). */
  assetSigner?: Signer;
}

/**
 * Build a TransactionBuilder that mints a single character Core asset into
 * the Time Machine collection. The returned `assetSigner` must sign the
 * transaction (so we surface it to callers who can attach it to their
 * tx-approval flow).
 */
export function buildCreateCharacterAssetTx(
  umi: Umi,
  args: CreateCharacterAssetArgs,
): { builder: TransactionBuilder; assetSigner: Signer } {
  const assetSigner = args.assetSigner ?? generateSigner(umi);
  const builder = createCoreAsset(umi, {
    asset: assetSigner,
    collection: { publicKey: toPublicKey(args.collection) } as unknown as AssetV1,
    name: args.name,
    uri: args.metadataUri,
    owner: toPublicKey(args.owner),
  });
  return { builder, assetSigner };
}

/**
 * Schema of the JSON metadata pinned to Irys for each character asset.
 * Pointed at by `metadataUri` on the on-chain Core asset.
 */
export interface CharacterMetadataDoc {
  name: string;
  description: string;
  image: string;
  attributes: Array<{ trait_type: string; value: string | number }>;
  properties?: {
    files?: Array<{ uri: string; type: string }>;
    category?: 'image';
  };
  /** Time-Machine-specific extension. */
  timeMachine: {
    canonicalName: string;
    slug: string;
    promptCid: string;
    portraitCid: string;
    registrationCid: string;
    metaPromptVersion: string;
    promptFingerprint: string;
    birthYear: number | null;
    deathYear: number | null;
  };
}

export function buildCharacterMetadataDoc(input: {
  canonicalName: string;
  slug: string;
  bioSummary: string;
  portraitUri: string;
  promptCid: string;
  portraitCid: string;
  registrationCid: string;
  metaPromptVersion: string;
  promptFingerprint: string;
  birthYear: number | null;
  deathYear: number | null;
  ticker: string;
}): CharacterMetadataDoc {
  return {
    name: input.canonicalName,
    description: input.bioSummary,
    image: input.portraitUri,
    attributes: [
      { trait_type: 'Era', value: input.birthYear ?? 'unknown' },
      { trait_type: 'Death year', value: input.deathYear ?? 'unknown' },
      { trait_type: 'Ticker', value: input.ticker },
    ],
    properties: {
      files: [{ uri: input.portraitUri, type: 'image/png' }],
      category: 'image',
    },
    timeMachine: {
      canonicalName: input.canonicalName,
      slug: input.slug,
      promptCid: input.promptCid,
      portraitCid: input.portraitCid,
      registrationCid: input.registrationCid,
      metaPromptVersion: input.metaPromptVersion,
      promptFingerprint: input.promptFingerprint,
      birthYear: input.birthYear,
      deathYear: input.deathYear,
    },
  };
}
