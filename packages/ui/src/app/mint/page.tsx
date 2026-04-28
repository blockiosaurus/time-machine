'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { api } from '../api-client';

type Step =
  | { kind: 'idle' }
  | { kind: 'canonicalizing' }
  | { kind: 'canonicalized'; jobId: string; canonical: NonNullable<Awaited<ReturnType<typeof api.canonicalize>>['canonical']>; suggestedTicker: string }
  | { kind: 'previewing' }
  | { kind: 'preview-ready'; jobId: string; preview: Awaited<ReturnType<typeof api.preview>> }
  | { kind: 'finalizing' }
  | { kind: 'confirming' }
  | { kind: 'success'; slug: string }
  | { kind: 'error'; message: string };

function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
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
      setStep({
        kind: 'canonicalized',
        jobId: r.jobId,
        canonical: r.canonical,
        suggestedTicker: r.canonical.suggestedTicker,
      });
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
    if (!wallet.publicKey || !wallet.signAllTransactions) return;
    setStep({ kind: 'finalizing' });
    try {
      const fin = await api.finalize(jobId, wallet.publicKey.toBase58());
      if (!fin.ok) {
        setStep({ kind: 'error', message: 'Finalize failed.' });
        return;
      }
      const conn = new Connection(rpcUrl());
      const txs = fin.userTransactions.map((t) =>
        VersionedTransaction.deserialize(Buffer.from(t.base64, 'base64')),
      );
      const signed = await wallet.signAllTransactions(txs);
      const sigs: string[] = [];
      for (const tx of signed) {
        const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        await conn.confirmTransaction(sig, 'confirmed');
        sigs.push(sig);
      }

      setStep({ kind: 'confirming' });
      const conf = await api.confirm(jobId, sigs);
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
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/explore" className="text-xl font-bold hover:text-zinc-300">
            Time Machine
          </Link>
          <WalletMultiButton />
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-10">
        <h2 className="text-2xl font-bold">Mint a historical figure</h2>
        <p className="mt-2 text-zinc-400">
          0.25 SOL fee. Mints an NFT, registers it on the Metaplex Agent Registry,
          and launches a Genesis token whose creator fees flow to you.
        </p>

        {step.kind === 'idle' && (
          <div className="mt-8 space-y-4">
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 outline-none focus:border-zinc-500"
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
                className="rounded-md bg-white px-4 py-2 font-medium text-zinc-950 disabled:opacity-50"
              >
                Look up
              </button>
            )}
          </div>
        )}

        {step.kind === 'canonicalizing' && <Spinner label="Canonicalizing…" />}

        {step.kind === 'canonicalized' && (
          <div className="mt-8 space-y-4">
            <Card>
              <h3 className="text-lg font-bold">{step.canonical.canonicalName}</h3>
              <p className="text-xs text-zinc-500">
                {step.canonical.birthYear ?? '?'} – {step.canonical.deathYear ?? '?'}
              </p>
              <p className="mt-2 text-sm text-zinc-300">{step.canonical.bioSummary}</p>
            </Card>
            <label className="block text-sm font-medium">Ticker</label>
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 uppercase outline-none focus:border-zinc-500"
              maxLength={10}
              minLength={3}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
            />
            <button
              onClick={() => buildPreview(step.jobId)}
              disabled={ticker.length < 3}
              className="rounded-md bg-white px-4 py-2 font-medium text-zinc-950 disabled:opacity-50"
            >
              Generate preview
            </button>
          </div>
        )}

        {step.kind === 'previewing' && <Spinner label="Generating prompt + portrait…" />}

        {step.kind === 'preview-ready' && (
          <div className="mt-8 space-y-4">
            <Card>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step.preview.portraitUri} alt="" className="aspect-square w-48 rounded-md object-cover" />
              <p className="mt-2 text-xs text-zinc-500">
                Slug: {step.preview.slug} · Fee: {step.preview.mintFeeLamports / 1_000_000_000} SOL
              </p>
            </Card>
            <button
              onClick={() => finalize(step.jobId)}
              className="rounded-md bg-white px-4 py-2 font-medium text-zinc-950"
            >
              Sign and mint
            </button>
          </div>
        )}

        {step.kind === 'finalizing' && <Spinner label="Building transactions…" />}
        {step.kind === 'confirming' && <Spinner label="Confirming on-chain…" />}

        {step.kind === 'success' && (
          <div className="mt-8 rounded-md border border-green-500/30 bg-green-500/10 p-4">
            <p className="font-medium text-green-300">Minted! 🎉</p>
            <Link href={`/chat/${step.slug}`} className="mt-2 inline-block text-white underline">
              Chat with your character →
            </Link>
          </div>
        )}

        {step.kind === 'error' && (
          <div className="mt-8 rounded-md border border-red-500/30 bg-red-500/10 p-4">
            <p className="text-red-400">{step.message}</p>
            <button
              onClick={() => setStep({ kind: 'idle' })}
              className="mt-2 text-sm text-zinc-300 underline"
            >
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
    <div className="mt-8 flex items-center gap-3 text-zinc-400">
      <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
      {label}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-zinc-800 bg-zinc-900 p-4">{children}</div>;
}
