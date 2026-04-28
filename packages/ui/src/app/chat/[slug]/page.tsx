'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { ChatPanel } from '@/components/chat-panel';
import { TimeMachineHeader } from '@/components/tm-header';
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
      <main className="grid min-h-screen place-items-center text-tm-gold-200/70">
        Character not found.{' '}
        <Link href="/" className="ml-2 tm-link-gold underline">Back to the gallery</Link>
      </main>
    );
  }
  if (!character) {
    return <main className="grid min-h-screen place-items-center text-tm-gold-200/70">Loading…</main>;
  }

  const tradeUrl = `https://genesis.metaplex.com/token/${character.genesisTokenMint}`;

  return (
    <main className="min-h-screen">
      <TimeMachineHeader />

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-4">
          <div className="tm-card overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={character.portraitUri}
              alt={character.canonicalName}
              className="aspect-square w-full object-cover"
            />
            <div className="p-4">
              <h2 className="tm-headline text-2xl font-bold text-tm-gold-50">{character.canonicalName}</h2>
              <p className="mt-1 text-xs uppercase tracking-widest text-tm-gold-400/80">
                {character.birthYear ?? '?'} – {character.deathYear ?? '?'} · ${character.genesisTicker}
              </p>
              <p className="mt-3 text-sm text-zinc-300">{character.bioSummary}</p>
            </div>
          </div>

          <div className="tm-card rounded-lg p-4">
            <h3 className="text-xs uppercase tracking-[0.3em] text-tm-gold-400/80">
              Token · ${character.genesisTicker}
            </h3>
            <p className="mt-2 break-all font-mono text-[10px] text-zinc-500">{character.genesisTokenMint}</p>
            <a
              href={tradeUrl}
              target="_blank"
              rel="noreferrer"
              className="tm-button-primary mt-4 block rounded-md py-2 text-center text-sm"
            >
              Buy on Genesis →
            </a>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              Creator fees from this token flow to the NFT owner: <span className="font-mono">{shorten(character.ownerWallet)}</span>
            </p>
          </div>
        </aside>

        <section className="tm-card rounded-lg p-4">
          {error && <div className="mb-2 rounded bg-red-500/10 p-2 text-xs text-red-300">{error}</div>}
          {isReconnecting && <div className="mb-2 text-xs text-tm-gold-400">Reconnecting…</div>}
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

function shorten(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
