'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type CharacterSummary } from '../api-client';

export default function ExplorePage() {
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listCharacters()
      .then((r) => setCharacters(r.characters ?? []))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <h1 className="text-xl font-bold">Time Machine</h1>
          <nav className="flex gap-4 text-sm text-zinc-300">
            <Link href="/explore" className="hover:text-white">Explore</Link>
            <Link href="/mint" className="hover:text-white">Mint</Link>
            <Link href="/my-characters" className="hover:text-white">My Characters</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-3xl font-bold">Chat with history.</h2>
            <p className="mt-2 max-w-xl text-zinc-400">
              Every character is a Solana NFT with its own Genesis token. Chat is free.
              Owners earn from token trading fees.
            </p>
          </div>
          <Link
            href="/mint"
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200"
          >
            Mint a character
          </Link>
        </div>

        {error && <div className="rounded-md bg-red-500/10 p-4 text-red-400">{error}</div>}
        {!characters && !error && <div className="text-zinc-400">Loading characters…</div>}
        {characters && characters.length === 0 && (
          <div className="rounded-md border border-zinc-800 p-8 text-center text-zinc-400">
            No characters yet. <Link href="/mint" className="text-white underline">Mint the first one</Link>.
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters?.map((c) => (
            <Link
              key={c.slug}
              href={`/chat/${c.slug}`}
              className="group rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-600"
            >
              <div className="aspect-square overflow-hidden rounded-md bg-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.portraitUri}
                  alt={c.canonicalName}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="mt-3">
                <h3 className="text-lg font-semibold">{c.canonicalName}</h3>
                <p className="text-xs text-zinc-500">
                  {c.birthYear ?? '?'} – {c.deathYear ?? '?'} · ${c.genesisTicker}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{c.bioSummary}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
