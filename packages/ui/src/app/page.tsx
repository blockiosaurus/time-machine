'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { TimeMachineHeader } from '@/components/tm-header';
import { api, type CharacterSummary } from './api-client';

export default function Home() {
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api
      .listCharacters()
      .then((r) => setCharacters(r.characters ?? []))
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!characters) return null;
    const q = query.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter(
      (c) =>
        c.canonicalName.toLowerCase().includes(q) ||
        c.genesisTicker.toLowerCase().includes(q) ||
        c.bioSummary.toLowerCase().includes(q),
    );
  }, [characters, query]);

  return (
    <main className="min-h-screen">
      <TimeMachineHeader />

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-12">
        {/* Hero */}
        <div className="mb-12 grid grid-cols-1 gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="max-w-2xl">
            <p className="mb-3 text-xs uppercase tracking-[0.3em] text-tm-gold-400/80">
              An on-chain salon of the dead
            </p>
            <h1 className="tm-headline text-4xl font-bold leading-tight text-tm-gold-50 sm:text-5xl">
              Chat with history.
            </h1>
            <p className="mt-4 max-w-xl text-zinc-300">
              Every figure here is a Solana NFT with its own Genesis token.
              Hold the token to step into their salon. Owners earn from the
              creator fees as the world talks to their figure.
            </p>
          </div>
          <Link
            href="/mint"
            className="tm-button-primary inline-flex items-center gap-2 self-start rounded-md px-5 py-2.5 sm:self-end"
          >
            Mint a character
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
              <path d="M3 8h10M9 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        {/* Search */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <svg
              viewBox="0 0 16 16"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tm-gold-400/70"
              fill="none"
            >
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M14 14l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the gallery…"
              className="w-full rounded-md border border-tm-gold-600/30 bg-tm-ink-900/60 py-2 pl-9 pr-3 text-sm text-tm-gold-50 placeholder:text-zinc-500 outline-none transition-colors focus:border-tm-gold-400"
            />
          </div>
          {characters && (
            <p className="hidden text-xs uppercase tracking-[0.3em] text-tm-gold-400/70 sm:block">
              {filtered?.length ?? 0} of {characters.length}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {error}
          </div>
        )}

        {!characters && !error && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {characters && characters.length === 0 && (
          <EmptyState />
        )}

        {filtered && filtered.length === 0 && characters && characters.length > 0 && (
          <div className="tm-card rounded-lg p-10 text-center text-zinc-400">
            <p className="tm-headline text-lg text-tm-gold-50">
              No one in the gallery answers to that name.
            </p>
            <button
              onClick={() => setQuery('')}
              className="mt-3 text-sm tm-link-gold underline"
            >
              Clear search
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered?.map((c, i) => (
            <Link
              key={c.slug}
              href={`/chat/${c.slug}`}
              className="tm-card group block overflow-hidden rounded-lg transition-transform hover:-translate-y-0.5 tm-card-rise"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <div className="relative aspect-square overflow-hidden bg-tm-ink-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.portraitUri}
                  alt={c.canonicalName}
                  className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-tm-ink-950/80 to-transparent" />
                <div className="absolute right-2 top-2 rounded-full border border-tm-gold-400/40 bg-tm-ink-950/70 px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-tm-gold-200 backdrop-blur-sm">
                  ${c.genesisTicker}
                </div>
              </div>
              <div className="p-4">
                <h3 className="tm-headline text-xl font-semibold text-tm-gold-50">
                  {c.canonicalName}
                </h3>
                <p className="mt-1 text-xs uppercase tracking-widest text-tm-gold-400/80">
                  {c.birthYear ?? '?'} – {c.deathYear ?? '?'}
                </p>
                <p className="mt-3 line-clamp-2 text-sm text-zinc-400">{c.bioSummary}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/5 px-6 py-8 text-center text-xs text-zinc-500">
        <p>Time Machine · NFTs on Metaplex Core · Tokens on Genesis</p>
      </footer>
    </main>
  );
}

function SkeletonCard() {
  return (
    <div className="tm-card overflow-hidden rounded-lg">
      <div className="tm-skeleton aspect-square w-full" />
      <div className="space-y-2 p-4">
        <div className="tm-skeleton h-5 w-3/5 rounded" />
        <div className="tm-skeleton h-3 w-2/5 rounded" />
        <div className="tm-skeleton h-3 w-full rounded" />
        <div className="tm-skeleton h-3 w-4/5 rounded" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="tm-card mx-auto max-w-lg rounded-lg p-10 text-center">
      <p className="tm-headline text-2xl font-semibold text-tm-gold-50">
        The gallery is quiet.
      </p>
      <p className="mt-3 text-sm text-zinc-400">
        No one has stepped through the time machine yet. Be the first to bring
        a figure of history into the conversation.
      </p>
      <Link
        href="/mint"
        className="tm-button-primary mt-5 inline-block rounded-md px-5 py-2"
      >
        Mint the first figure
      </Link>
    </div>
  );
}
