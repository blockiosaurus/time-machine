/**
 * One-time bootstrap script: create the "Time Machine" MPL Core collection.
 *
 * Usage:
 *   pnpm tsx scripts/create-collection.ts
 *
 * Requires AGENT_KEYPAIR (used to pay + sign), SOLANA_RPC_URL, and
 * PUBLIC_BASE_URL (where the static collection metadata is hosted) to be
 * set. After success, copy the printed address into COLLECTION_ADDRESS in
 * your .env and never run this script again for that environment.
 *
 * The on-chain collection's URI points at the statically-hosted metadata
 * file shipped with the UI:
 *   - packages/ui/public/collection/metadata.json
 *   - packages/ui/public/collection/image.svg
 *
 * No Irys upload — the metadata + image live next to the UI deployment so
 * they're trivially editable post-deploy and never expire.
 */

import {
  buildCreateCollectionTx,
  createUmi,
  getConfig,
  TIME_MACHINE_COLLECTION_NAME,
} from '@metaplex-agent/shared';

async function main() {
  const config = getConfig();
  const umi = createUmi();

  const metadataUri = `${config.PUBLIC_BASE_URL.replace(/\/$/, '')}/collection/metadata.json`;

  console.log(`Creating "${TIME_MACHINE_COLLECTION_NAME}" Core collection`);
  console.log(`  Authority: ${umi.identity.publicKey.toString()}`);
  console.log(`  Metadata URI: ${metadataUri}`);

  // Sanity check: confirm the metadata URL is reachable. The SVG image is
  // referenced from inside that JSON, so as long as both files are deployed
  // at PUBLIC_BASE_URL, indexers will resolve them.
  try {
    const res = await fetch(metadataUri);
    if (!res.ok) {
      console.warn(
        `WARN: ${metadataUri} returned ${res.status}. ` +
        'Make sure the UI is deployed and serving /collection/metadata.json before clients try to resolve this collection.',
      );
    } else {
      const json = await res.json();
      console.log(`  Verified: name="${json.name}", image="${json.image}"`);
    }
  } catch (e) {
    console.warn(`WARN: could not reach ${metadataUri}: ${(e as Error).message}`);
    console.warn('  Continuing anyway — the on-chain URI is set even if the host isn\'t up yet.');
  }

  const { builder, collectionSigner } = buildCreateCollectionTx(umi, {
    metadataUri,
  });

  console.log('Sending create-collection transaction...');
  const result = await builder.sendAndConfirm(umi);
  console.log(`  signature: ${Buffer.from(result.signature).toString('base64')}`);
  console.log('');
  console.log('Collection created successfully.');
  console.log(`  COLLECTION_ADDRESS=${collectionSigner.publicKey.toString()}`);
  console.log('');
  console.log('Add the line above to your .env (do not commit).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
