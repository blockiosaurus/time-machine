'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TimeMachineHeader } from '@/components/tm-header';
import { api, type CharacterSummary } from './api-client';

export default function Home() {
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listCharacters()
      .then((r) => setCharacters(r.characters ?? []))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="min-h-screen">
      <TimeMachineHeader />

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-12">
        <div className="mb-12 flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="mb-3 text-xs uppercase tracking-[0.3em] text-tm-gold-400/80">
              An on-chain salon of the dead
            </p>
            <h1 className="tm-headline text-4xl font-bold leading-tight text-tm-gold-50 sm:text-5xl">
              Chat with history.
            </h1>
            <p className="mt-4 text-zinc-300">
              Every character is a Solana NFT with its own Genesis token.
              Conversation is free and open. Owners earn from the token's
              creator fees as the world talks to their figure.
            </p>
          </div>
          <Link href="/mint" className="tm-button-primary rounded-md px-5 py-2.5">
            Mint a character
          </Link>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {error}
          </div>
        )}
        {!characters && !error && (
          <div className="text-tm-gold-200/60">Loading the gallery…</div>
        )}
        {characters && characters.length === 0 && (
          <div className="tm-card rounded-lg p-10 text-center text-zinc-400">
            The gallery is empty. <Link href="/mint" className="tm-link-gold underline">Mint the first figure</Link>.
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {characters?.map((c) => (
            <Link
              key={c.slug}
              href={`/chat/${c.slug}`}
              className="tm-card group block overflow-hidden rounded-lg transition"
            >
              <div className="aspect-square overflow-hidden bg-tm-ink-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.portraitUri}
                  alt={c.canonicalName}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <div className="p-4">
                <h3 className="tm-headline text-xl font-semibold text-tm-gold-50">
                  {c.canonicalName}
                </h3>
                <p className="mt-1 text-xs uppercase tracking-widest text-tm-gold-400/80">
                  {c.birthYear ?? '?'} – {c.deathYear ?? '?'} · ${c.genesisTicker}
                </p>
                <p className="mt-3 line-clamp-2 text-sm text-zinc-400">{c.bioSummary}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/5 px-6 py-6 text-center text-xs text-zinc-500">
        Time Machine · Built on Metaplex Core, Agent Registry, and Genesis.
      </footer>
    </main>
  );
}
