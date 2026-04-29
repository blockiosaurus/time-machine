'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import type { CreateLaunchInput } from '@metaplex-foundation/genesis';
import { TimeMachineHeader } from '@/components/tm-header';
import { MintProgress, type MintPhaseKind } from '@/components/mint-progress';
import { api, type PreviewResponse } from '../api-client';
import { registerLaunchFromWallet } from '../genesis-client';

type Step =
  | { kind: 'idle' }
  | { kind: 'canonicalizing' }
  | { kind: 'canonicalized'; jobId: string; canonical: NonNullable<Awaited<ReturnType<typeof api.canonicalize>>['canonical']> }
  | { kind: 'previewing' }
  | { kind: 'preview-ready'; jobId: string; preview: PreviewResponse }
  | { kind: 'awaiting-fee' }
  | { kind: 'pinning' }
  | { kind: 'awaiting-asset' }
  | { kind: 'building-genesis' }
  | { kind: 'awaiting-genesis' }
  | { kind: 'registering-genesis' }
  | { kind: 'confirming' }
  | { kind: 'success'; slug: string }
  | { kind: 'error'; message: string };

function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
}

async function signAndSubmit(
  conn: Connection,
  wallet: ReturnType<typeof useWallet>,
  base64Tx: string,
): Promise<string> {
  if (!wallet.signTransaction) throw new Error('Wallet does not support signTransaction');
  const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, 'base64'));
  const signed = await wallet.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

export default function MintPage() {
  const wallet = useWallet();
  const [rawName, setRawName] = useState('');
  const [ticker, setTicker] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  const start = async () => {
    if (!wallet.publicKey) return;
    setStep({ kind: 'canonicalizing' });
    try {
      const r = await api.canonicalize(rawName, wallet.publicKey.toBase58());
      if (!r.ok || !r.canonical) {
        setStep({ kind: 'error', message: r.message ?? 'Rejected.' });
        return;
      }
      setTicker(r.canonical.suggestedTicker);
      setStep({ kind: 'canonicalized', jobId: r.jobId, canonical: r.canonical });
    } catch (e) {
      setStep({ kind: 'error', message: (e as Error).message });
    }
  };

  const buildPreview = async (jobId: string) => {
    setStep({ kind: 'previewing' });
    try {
      const r = await api.preview(jobId, ticker);
      if (!r.ok) {
        setStep({ kind: 'error', message: 'Preview failed.' });
        return;
      }
      setStep({ kind: 'preview-ready', jobId, preview: r });
    } catch (e) {
      setStep({ kind: 'error', message: (e as Error).message });
    }
  };

  const finalize = async (jobId: string) => {
    if (!wallet.publicKey) return;
    const conn = new Connection(rpcUrl(), 'confirmed');
    const owner = wallet.publicKey.toBase58();

    try {
      // 1. Build + sign fee tx.
      setStep({ kind: 'awaiting-fee' });
      const feeRes = await api.buildFeeTx(jobId, owner);
      if (!feeRes.ok) throw new Error('Could not build fee transaction.');
      const feeSig = await signAndSubmit(conn, wallet, feeRes.feeTx.base64);

      // 2. Server pins to Irys + builds create+register tx.
      setStep({ kind: 'pinning' });
      const assetRes = await api.buildAssetTx(jobId, owner, feeSig);
      if (!assetRes.ok) throw new Error('Could not build asset transaction.');

      // 3. Sign + submit asset tx.
      setStep({ kind: 'awaiting-asset' });
      const assetSig = await signAndSubmit(conn, wallet, assetRes.assetTx.base64);

      // 4. Server builds Genesis txs.
      setStep({ kind: 'building-genesis' });
      const genesisRes = await api.buildGenesisTxs(jobId, owner, assetSig);
      if (!genesisRes.ok) throw new Error('Could not build Genesis transactions.');

      // 5. Sign + submit Genesis txs.
      setStep({ kind: 'awaiting-genesis' });
      const genesisSigs: string[] = [];
      for (const tx of genesisRes.genesisTxs) {
        const sig = await signAndSubmit(conn, wallet, tx.base64);
        genesisSigs.push(sig);
      }

      // 6. Register the launch with Genesis from the user's wallet — only
      //    the agent NFT owner can authenticate this call. If it fails we
      //    abort BEFORE creating the character row so the on-chain state
      //    and the DB don't desync.
      setStep({ kind: 'registering-genesis' });
      await registerLaunchFromWallet({
        rpcUrl: rpcUrl(),
        wallet,
        genesisAccount: genesisRes.genesisAccount,
        createLaunchInput: genesisRes.createLaunchInput as CreateLaunchInput,
      });

      // 7. Confirm + persist.
      setStep({ kind: 'confirming' });
      const conf = await api.confirm(jobId, owner, genesisSigs);
      if (conf.ok && conf.character?.slug) {
        setStep({ kind: 'success', slug: conf.character.slug });
      } else {
        setStep({ kind: 'error', message: 'Mint did not confirm.' });
      }
    } catch (e) {
      setStep({ kind: 'error', message: (e as Error).message });
    }
  };

  return (
    <main className="min-h-screen">
      <TimeMachineHeader />

      <section className="mx-auto max-w-3xl px-6 py-12">
        <p className="mb-2 text-xs uppercase tracking-[0.3em] text-tm-gold-400/80">Step into the salon</p>
        <h2 className="tm-headline text-3xl font-bold text-tm-gold-50">Mint a historical figure</h2>
        <p className="mt-3 text-zinc-300">
          0.25 SOL fee. Mints an NFT, registers it on the Metaplex Agent Registry,
          and launches a Genesis token whose creator fees flow to you.
        </p>

        {step.kind === 'idle' && (
          <div className="mt-10 space-y-4">
            <input
              className="w-full rounded-md border border-tm-gold-600/40 bg-tm-ink-800/60 p-3 outline-none focus:border-tm-gold-200"
              placeholder="Albert Einstein, Cleopatra, Sun Tzu…"
              value={rawName}
              onChange={(e) => setRawName(e.target.value)}
            />
            {!wallet.publicKey ? (
              <WalletMultiButton />
            ) : (
              <button
                onClick={start}
                disabled={!rawName.trim()}
                className="tm-button-primary rounded-md px-5 py-2.5"
              >
                Look up
              </button>
            )}
          </div>
        )}

        {step.kind === 'canonicalizing' && <Spinner label="Searching the historical record…" />}

        {step.kind === 'canonicalized' && (
          <div className="mt-10 space-y-4">
            <Card>
              <h3 className="tm-headline text-xl font-bold text-tm-gold-50">{step.canonical.canonicalName}</h3>
              <p className="text-xs uppercase tracking-widest text-tm-gold-400/80">
                {step.canonical.birthYear ?? '?'} – {step.canonical.deathYear ?? '?'}
              </p>
              <p className="mt-3 text-sm text-zinc-300">{step.canonical.bioSummary}</p>
            </Card>
            <label className="block text-sm font-medium text-tm-gold-200">Ticker</label>
            <input
              className="w-full rounded-md border border-tm-gold-600/40 bg-tm-ink-800/60 p-3 uppercase tracking-widest outline-none focus:border-tm-gold-200"
              maxLength={10}
              minLength={3}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
            />
            <button
              onClick={() => buildPreview(step.jobId)}
              disabled={ticker.length < 3}
              className="tm-button-primary rounded-md px-5 py-2.5"
            >
              Generate preview
            </button>
          </div>
        )}

        {step.kind === 'previewing' && <Spinner label="Composing prompt and portrait…" />}

        {step.kind === 'preview-ready' && (
          <div className="mt-10 space-y-4">
            <Card>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${api.base()}${step.preview.portraitUrl}`}
                alt=""
                className="aspect-square w-56 rounded-md object-cover"
              />
              <p className="mt-3 text-xs uppercase tracking-widest text-tm-gold-400/80">
                /{step.preview.slug} · Fee {step.preview.mintFeeLamports / 1_000_000_000} SOL
              </p>
            </Card>
            <button onClick={() => finalize(step.jobId)} className="tm-button-primary rounded-md px-5 py-2.5">
              Sign and mint
            </button>
            <p className="text-xs text-zinc-500">
              You'll be asked to sign 3–4 transactions: the mint fee, the asset + registry,
              and the Genesis token launch.
            </p>
          </div>
        )}

        {(step.kind === 'awaiting-fee' ||
          step.kind === 'pinning' ||
          step.kind === 'awaiting-asset' ||
          step.kind === 'building-genesis' ||
          step.kind === 'awaiting-genesis' ||
          step.kind === 'registering-genesis' ||
          step.kind === 'confirming' ||
          step.kind === 'success') && (
          <div className="mt-10">
            <MintProgress step={step.kind as MintPhaseKind} />
            {step.kind === 'success' && (
              <div className="mt-6 rounded-md border border-tm-gold-400/40 bg-tm-gold-200/5 p-5 animate-tm-fade-in">
                <p className="tm-headline text-lg text-tm-gold-50">
                  {/* Final flourish */}
                  Welcome them to the salon.
                </p>
                <Link
                  href={`/chat/${step.slug}`}
                  className="mt-2 inline-block tm-link-gold underline"
                >
                  Speak with your character →
                </Link>
              </div>
            )}
          </div>
        )}

        {step.kind === 'error' && (
          <div className="mt-10 rounded-md border border-red-500/30 bg-red-500/10 p-5">
            <p className="text-red-300">{step.message}</p>
            <button onClick={() => setStep({ kind: 'idle' })} className="mt-3 text-sm text-tm-gold-200 underline">
              Try again
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="mt-10 flex items-center gap-3 text-tm-gold-200/80">
      <span className="h-2 w-2 animate-pulse rounded-full bg-tm-gold-200" />
      {label}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="tm-card rounded-md p-5">{children}</div>;
}
