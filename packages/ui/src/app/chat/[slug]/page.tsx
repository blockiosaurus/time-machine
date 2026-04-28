'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { ChatPanel } from '@/components/chat-panel';
import { usePlexChat } from '@/hooks/use-plexchat';
import { wsUrl, wsToken } from '../../env';
import { api, type CharacterSummary } from '../../api-client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default function ChatPage({ params }: PageProps) {
  const { slug } = use(params);
  const wallet = useWallet();
  const [character, setCharacter] = useState<CharacterSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCharacter(slug)
      .then(setCharacter)
      .catch((e) => setLoadError(e.message));
  }, [slug]);

  const baseUrl = wsUrl();
  // Append slug query param so the server loads the per-character agent.
  const characterWsUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}slug=${encodeURIComponent(slug)}`;

  const {
    messages,
    isConnected,
    isReconnecting,
    isAgentTyping,
    error,
    sendMessage,
    sendWalletConnect,
    sendWalletDisconnect,
  } = usePlexChat({
    url: characterWsUrl,
    token: wsToken(),
    onTransaction: () => undefined,
    onDebugEvent: () => undefined,
  });

  useEffect(() => {
    if (wallet.publicKey) sendWalletConnect(wallet.publicKey.toBase58());
    else sendWalletDisconnect();
  }, [wallet.publicKey, sendWalletConnect, sendWalletDisconnect]);

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-400">
        Character not found. <Link href="/explore" className="ml-2 underline">Back to explore</Link>
      </main>
    );
  }
  if (!character) {
    return <main className="grid min-h-screen place-items-center bg-zinc-950 text-zinc-400">Loading…</main>;
  }

  const tradeUrl = `https://genesis.metaplex.com/token/${character.genesisTokenMint}`;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/explore" className="text-sm text-zinc-300 hover:text-white">← Explore</Link>
          <WalletMultiButton />
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[1fr_2fr]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={character.portraitUri}
              alt={character.canonicalName}
              className="aspect-square w-full rounded-md object-cover"
            />
            <h2 className="mt-3 text-xl font-bold">{character.canonicalName}</h2>
            <p className="text-xs text-zinc-500">
              {character.birthYear ?? '?'} – {character.deathYear ?? '?'} · ${character.genesisTicker}
            </p>
            <p className="mt-3 text-sm text-zinc-400">{character.bioSummary}</p>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <h3 className="text-sm font-semibold text-zinc-300">${character.genesisTicker}</h3>
            <p className="mt-1 text-xs text-zinc-500 break-all">{character.genesisTokenMint}</p>
            <a
              href={tradeUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block w-full rounded-md bg-white py-2 text-center text-sm font-medium text-zinc-950 hover:bg-zinc-200"
            >
              Buy on Genesis →
            </a>
          </div>
        </aside>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          {error && <div className="mb-2 rounded bg-red-500/10 p-2 text-xs text-red-400">{error}</div>}
          {isReconnecting && <div className="mb-2 text-xs text-amber-400">Reconnecting…</div>}
          <ChatPanel
            messages={messages}
            isConnected={isConnected}
            isAgentTyping={isAgentTyping}
            isWalletConnected={!!wallet.publicKey}
            onSendMessage={sendMessage}
          />
        </section>
      </div>
    </main>
  );
}
