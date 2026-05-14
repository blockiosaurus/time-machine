'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import type { CreateLaunchInput } from '@metaplex-foundation/genesis';
import { TimeMachineHeader } from '@/components/tm-header';
import { MintProgress, type MintPhaseKind } from '@/components/mint-progress';
import { useServerConfig, formatSol } from '@/hooks/use-server-config';
import { api, type PreviewResponse } from '../api-client';
import { registerLaunchFromWallet } from '../genesis-client';

type Step =
  | { kind: 'idle' }
  | { kind: 'canonicalizing' }
  | { kind: 'canonicalized'; jobId: string; canonical: NonNullable<Awaited<ReturnType<typeof api.canonicalize>>['canonical']> }
  | { kind: 'previewing' }
  | { kind: 'preview-ready'; jobId: string; preview: PreviewResponse; canonical: NonNullable<Awaited<ReturnType<typeof api.canonicalize>>['canonical']> }
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

function networkLabel(): string {
  const u = rpcUrl().toLowerCase();
  if (u.includes('devnet')) return 'Solana devnet';
  if (u.includes('testnet')) return 'Solana testnet';
  return 'Solana mainnet';
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

const isProcessingStep = (k: Step['kind']) =>
  k === 'awaiting-fee' ||
  k === 'pinning' ||
  k === 'awaiting-asset' ||
  k === 'building-genesis' ||
  k === 'awaiting-genesis' ||
  k === 'registering-genesis' ||
  k === 'confirming' ||
  k === 'success';

export default function MintPage() {
  const wallet = useWallet();
  const serverConfig = useServerConfig();
  const [rawName, setRawName] = useState('');
  const [ticker, setTicker] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  const mintFeeLabel = serverConfig
    ? formatSol(serverConfig.mintFeeLamports)
    : '…';

  const reset = () => {
    setRawName('');
    setTicker('');
    setStep({ kind: 'idle' });
  };

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

  const buildPreview = async (jobId: string, canonical: NonNullable<Awaited<ReturnType<typeof api.canonicalize>>['canonical']>) => {
    setStep({ kind: 'previewing' });
    try {
      const r = await api.preview(jobId, ticker);
      if (!r.ok) {
        setStep({ kind: 'error', message: 'Preview failed.' });
        return;
      }
      setStep({ kind: 'preview-ready', jobId, preview: r, canonical });
    } catch (e) {
      setStep({ kind: 'error', message: (e as Error).message });
    }
  };

  const finalize = async (jobId: string) => {
    if (!wallet.publicKey) return;
    const conn = new Connection(rpcUrl(), 'confirmed');
    const owner = wallet.publicKey.toBase58();

    try {
      setStep({ kind: 'awaiting-fee' });
      const feeRes = await api.buildFeeTx(jobId, owner);
      if (!feeRes.ok) throw new Error('Could not build fee transaction.');
      const feeSig = await signAndSubmit(conn, wallet, feeRes.feeTx.base64);

      setStep({ kind: 'pinning' });
      const assetRes = await api.buildAssetTx(jobId, owner, feeSig);
      if (!assetRes.ok) throw new Error('Could not build asset transaction.');

      setStep({ kind: 'awaiting-asset' });
      const assetSig = await signAndSubmit(conn, wallet, assetRes.assetTx.base64);

      setStep({ kind: 'building-genesis' });
      const genesisRes = await api.buildGenesisTxs(jobId, owner, assetSig);
      if (!genesisRes.ok) throw new Error('Could not build Genesis transactions.');

      setStep({ kind: 'awaiting-genesis' });
      const genesisSigs: string[] = [];
      for (const tx of genesisRes.genesisTxs) {
        const sig = await signAndSubmit(conn, wallet, tx.base64);
        genesisSigs.push(sig);
      }

      setStep({ kind: 'registering-genesis' });
      await registerLaunchFromWallet({
        rpcUrl: rpcUrl(),
        wallet,
        genesisAccount: genesisRes.genesisAccount,
        createLaunchInput: genesisRes.createLaunchInput as CreateLaunchInput,
      });

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
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.3em] text-tm-gold-400/80">
              Step into the salon
            </p>
            <h2 className="tm-headline text-3xl font-bold text-tm-gold-50">
              Mint a historical figure
            </h2>
            <p className="mt-3 max-w-xl text-zinc-300">
              {mintFeeLabel} fee. We mint your NFT, register it on the
              Metaplex Agent Registry, and launch a Genesis token whose
              creator fees flow to you.
            </p>
          </div>
          {(step.kind !== 'idle' && step.kind !== 'success') && (
            <button
              onClick={reset}
              className="rounded border border-tm-gold-600/30 px-3 py-1.5 text-xs text-tm-gold-200/80 transition-colors hover:border-tm-gold-400 hover:text-tm-gold-50"
            >
              Start over
            </button>
          )}
        </div>

        {/* IDLE */}
        {step.kind === 'idle' && (
          <div className="mt-10 space-y-5 tm-card-rise">
            <div className="tm-card rounded-md p-5">
              <label className="block text-xs uppercase tracking-[0.25em] text-tm-gold-400/80">
                Who do you want to summon?
              </label>
              <input
                className="mt-3 w-full rounded-md border border-tm-gold-600/40 bg-tm-ink-800/60 p-3 text-tm-gold-50 outline-none transition-colors focus:border-tm-gold-200"
                placeholder="Albert Einstein, Cleopatra, Sun Tzu…"
                value={rawName}
                onChange={(e) => setRawName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && rawName.trim() && wallet.publicKey) start();
                }}
                autoFocus
              />
              <p className="mt-2 text-xs text-zinc-500">
                Anyone real, deceased at least 25 years. We'll canonicalize the
                name and check for duplicates.
              </p>
            </div>

            {!wallet.publicKey ? (
              <div className="tm-card rounded-md p-5">
                <p className="text-sm text-tm-gold-50">
                  You'll need a Solana wallet to mint.
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Phantom, Solflare, or any standard adapter works.
                </p>
                <div className="mt-4">
                  <WalletMultiButton />
                </div>
              </div>
            ) : (
              <button
                onClick={start}
                disabled={!rawName.trim()}
                className="tm-button-primary rounded-md px-6 py-2.5 disabled:opacity-50"
              >
                Search the records →
              </button>
            )}
          </div>
        )}

        {step.kind === 'canonicalizing' && (
          <Spinner label="Searching the historical record…" />
        )}

        {/* CANONICALIZED */}
        {step.kind === 'canonicalized' && (
          <div className="mt-10 space-y-5 tm-card-rise">
            <div className="tm-card rounded-md p-5">
              <p className="text-xs uppercase tracking-[0.25em] text-tm-gold-400/80">
                Found them
              </p>
              <h3 className="tm-headline mt-1 text-2xl font-bold text-tm-gold-50">
                {step.canonical.canonicalName}
              </h3>
              <p className="mt-1 text-xs uppercase tracking-widest text-tm-gold-400/80">
                {step.canonical.birthYear ?? '?'} – {step.canonical.deathYear ?? '?'}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                {step.canonical.bioSummary}
              </p>
              {step.canonical.aliases.length > 0 && (
                <p className="mt-3 text-xs text-zinc-500">
                  Also known as: {step.canonical.aliases.join(', ')}
                </p>
              )}
            </div>

            <div className="tm-card rounded-md p-5">
              <label className="block text-xs uppercase tracking-[0.25em] text-tm-gold-400/80">
                Token ticker
              </label>
              <p className="mt-1 text-xs text-zinc-500">
                3–10 uppercase letters. This is what shows up on Genesis.
              </p>
              <input
                className="mt-3 w-full rounded-md border border-tm-gold-600/40 bg-tm-ink-800/60 p-3 text-lg uppercase tracking-widest text-tm-gold-50 outline-none transition-colors focus:border-tm-gold-200"
                maxLength={10}
                minLength={3}
                value={ticker}
                onChange={(e) =>
                  setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))
                }
              />
              {ticker !== step.canonical.suggestedTicker && (
                <button
                  onClick={() => setTicker(step.canonical.suggestedTicker)}
                  className="mt-2 text-xs tm-link-gold underline"
                >
                  Use suggested: {step.canonical.suggestedTicker}
                </button>
              )}
            </div>

            <button
              onClick={() => buildPreview(step.jobId, step.canonical)}
              disabled={ticker.length < 3}
              className="tm-button-primary rounded-md px-6 py-2.5 disabled:opacity-50"
            >
              Generate preview →
            </button>
          </div>
        )}

        {step.kind === 'previewing' && (
          <Spinner label="Composing the prompt and portrait…" />
        )}

        {/* PREVIEW READY → confirm-and-mint summary */}
        {step.kind === 'preview-ready' && (
          <div className="mt-10 space-y-5 tm-card-rise">
            <div className="tm-card overflow-hidden rounded-md">
              <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr]">
                <div className="bg-tm-ink-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${api.base()}${step.preview.portraitUrl}`}
                    alt={step.canonical.canonicalName}
                    className="aspect-square w-full object-cover"
                  />
                </div>
                <div className="p-5">
                  <p className="text-xs uppercase tracking-[0.25em] text-tm-gold-400/80">
                    Preview
                  </p>
                  <h3 className="tm-headline mt-1 text-2xl font-bold text-tm-gold-50">
                    {step.canonical.canonicalName}
                  </h3>
                  <p className="mt-0.5 text-xs uppercase tracking-widest text-tm-gold-400/80">
                    /{step.preview.slug} · ${ticker}
                  </p>
                  <p className="mt-3 line-clamp-4 text-sm text-zinc-300">
                    {step.canonical.bioSummary}
                  </p>
                </div>
              </div>
            </div>

            <div className="tm-card rounded-md p-5">
              <p className="text-xs uppercase tracking-[0.25em] text-tm-gold-400/80">
                What you'll sign
              </p>
              <dl className="mt-4 space-y-2.5 text-sm">
                <SummaryRow label="Mint fee" value={`${step.preview.mintFeeLamports / 1_000_000_000} SOL`} />
                <SummaryRow label="Network" value={networkLabel()} />
                <SummaryRow label="Slug" value={`/chat/${step.preview.slug}`} />
                <SummaryRow label="Ticker" value={`$${ticker}`} />
                <SummaryRow label="Wallet popups" value="3 — fee, asset, then a Genesis batch + sign-in" />
              </dl>
              <p className="mt-4 text-xs text-zinc-500">
                Once you sign the fee, the asset and Genesis launch are
                paid by you and signed in your wallet. Creator fees from
                the bonding curve flow to your wallet.
              </p>
            </div>

            <button
              onClick={() => finalize(step.jobId)}
              className="tm-button-primary rounded-md px-6 py-2.5"
            >
              Sign and mint →
            </button>
          </div>
        )}

        {/* PROGRESS */}
        {isProcessingStep(step.kind) && (
          <div className="mt-10 space-y-5">
            <MintProgress step={step.kind as MintPhaseKind} mintFeeLabel={mintFeeLabel} />
            {step.kind === 'success' && (
              <div className="rounded-md border border-tm-gold-400/40 bg-tm-gold-200/5 p-5 animate-tm-fade-in">
                <p className="tm-headline text-lg text-tm-gold-50">
                  Welcome them to the salon.
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  Your character is live and listening. Conversation is open
                  to you and to anyone holding ${ticker}.
                </p>
                <Link
                  href={`/chat/${step.slug}`}
                  className="tm-button-primary mt-4 inline-block rounded-md px-5 py-2"
                >
                  Open the chat →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ERROR */}
        {step.kind === 'error' && (
          <div className="mt-10 rounded-md border border-red-500/30 bg-red-500/10 p-5 tm-card-rise">
            <p className="tm-headline text-lg text-red-200">Something went sideways.</p>
            <p className="mt-2 text-sm text-red-300">{step.message}</p>
            <button onClick={reset} className="mt-3 text-sm tm-link-gold underline">
              Start over
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-tm-gold-600/10 pb-2 last:border-0 last:pb-0">
      <dt className="text-xs uppercase tracking-widest text-zinc-500">{label}</dt>
      <dd className="text-right text-tm-gold-50">{value}</dd>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="mt-10 flex items-center gap-3 text-tm-gold-200/80 tm-card-rise">
      <span className="h-2 w-2 animate-pulse rounded-full bg-tm-gold-200" />
      {label}
    </div>
  );
}
