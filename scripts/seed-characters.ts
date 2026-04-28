/**
 * Seed the Time Machine gallery with the 10 starter characters.
 *
 * Hits the running server's HTTP API end-to-end (canonicalize → preview →
 * finalize → sign+submit user txs → confirm). Uses AGENT_KEYPAIR as the
 * "founder" owner wallet for all 10 characters. Run once at deploy time
 * AFTER the server is up and AFTER scripts/create-collection.ts has been
 * run.
 *
 * Usage:
 *   pnpm tsx scripts/seed-characters.ts
 *
 * Requires: SERVER_URL (default http://localhost:3002), AGENT_KEYPAIR,
 *           SOLANA_RPC_URL, COLLECTION_ADDRESS.
 */

import {
  Connection,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const STARTERS: Array<{ name: string; ticker: string }> = [
  { name: 'George Washington', ticker: 'GWASH' },
  { name: 'Abraham Lincoln', ticker: 'HONABE' },
  { name: 'Albert Einstein', ticker: 'EINSTEIN' },
  { name: 'Isaac Newton', ticker: 'NEWTON' },
  { name: 'Leonardo da Vinci', ticker: 'DAVINCI' },
  { name: 'Cleopatra', ticker: 'CLEO' },
  { name: 'Napoleon Bonaparte', ticker: 'NAPOLEON' },
  { name: 'Nikola Tesla', ticker: 'TESLA' },
  { name: 'Marie Curie', ticker: 'CURIE' },
  { name: 'Sun Tzu', ticker: 'SUNTZU' },
];

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3002';
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

function loadKeypair(): Keypair {
  const raw = (process.env.AGENT_KEYPAIR ?? '').trim();
  if (!raw) throw new Error('AGENT_KEYPAIR is required');
  if (raw.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function api<T>(path: string, body?: unknown, method: string = 'POST'): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function seedOne(
  starter: { name: string; ticker: string },
  signer: Keypair,
  conn: Connection,
): Promise<void> {
  console.log(`\n=== Seeding ${starter.name} ===`);

  const canon = await api<{
    ok: boolean;
    jobId: string;
    canonical?: { canonicalName: string };
    reason?: string;
    message?: string;
  }>('/api/mint/canonicalize', {
    rawName: starter.name,
    wallet: signer.publicKey.toBase58(),
  });
  if (!canon.ok) {
    console.log(`  Skipped (${canon.reason}): ${canon.message ?? ''}`);
    return;
  }
  console.log(`  Canonicalized: ${canon.canonical?.canonicalName} (jobId ${canon.jobId})`);

  const preview = await api<{ ok: boolean; slug: string }>(
    '/api/mint/preview',
    { mintJobId: canon.jobId, ticker: starter.ticker },
  );
  if (!preview.ok) throw new Error('preview failed');
  console.log(`  Preview ready: slug=${preview.slug}`);

  const finalize = await api<{
    ok: boolean;
    serverSignature: string;
    assetAddress: string;
    userTransactions: Array<{ id: string; base64: string }>;
  }>('/api/mint/finalize', {
    mintJobId: canon.jobId,
    ownerWallet: signer.publicKey.toBase58(),
  });
  if (!finalize.ok) throw new Error('finalize failed');
  console.log(`  Server tx: ${finalize.serverSignature}`);
  console.log(`  Asset: ${finalize.assetAddress}`);

  const sigs: string[] = [];
  for (const ut of finalize.userTransactions) {
    const tx = VersionedTransaction.deserialize(Buffer.from(ut.base64, 'base64'));
    tx.sign([signer]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction(sig, 'confirmed');
    sigs.push(sig);
    console.log(`    ${ut.id} -> ${sig}`);
  }

  const confirmed = await api<{ ok: boolean; character?: { slug: string } }>(
    '/api/mint/confirm',
    { mintJobId: canon.jobId, signatures: sigs },
  );
  if (!confirmed.ok) throw new Error('confirm failed');
  console.log(`  Confirmed: /chat/${confirmed.character?.slug}`);
}

async function main() {
  const signer = loadKeypair();
  const conn = new Connection(RPC_URL, 'confirmed');
  console.log(`Founder wallet: ${signer.publicKey.toBase58()}`);
  console.log(`Server: ${SERVER_URL}`);

  for (const starter of STARTERS) {
    try {
      await seedOne(starter, signer, conn);
    } catch (e) {
      console.error(`  FAILED ${starter.name}:`, (e as Error).message);
    }
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
