'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import bs58 from 'bs58';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
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
  const signedFor = useRef<string | null>(null);

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
    tmAuthChallenge,
  } = usePlexChat({
    url: characterWsUrl,
    token: wsToken(),
    onTransaction: () => undefined,
    onDebugEvent: () => undefined,
  });

  // When the wallet is connected and we have an unsigned challenge from the
  // server, prompt for a sign-message and forward to the server. Tracked in
  // a ref so we don't re-prompt on every render.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wallet.publicKey || !wallet.signMessage) {
        sendWalletDisconnect();
        signedFor.current = null;
        return;
      }
      if (!tmAuthChallenge) return;
      const key = `${wallet.publicKey.toBase58()}:${tmAuthChallenge}`;
      if (signedFor.current === key) return;
      try {
        const sig = await wallet.signMessage(new TextEncoder().encode(tmAuthChallenge));
        if (cancelled) return;
        sendWalletConnect(wallet.publicKey.toBase58(), bs58.encode(sig));
        signedFor.current = key;
      } catch (e) {
        // User rejected. They can click "Connect & Sign" again.
        signedFor.current = null;
        console.warn('User declined sign-message:', (e as Error).message);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [wallet.publicKey, wallet.signMessage, tmAuthChallenge, sendWalletConnect, sendWalletDisconnect]);

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
  const accessDenied = !!error && error.toLowerCase().includes('access') ;

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
              Owner-or-holder access only. Holding any ${character.genesisTicker} grants chat. Owner: <span className="font-mono">{shorten(character.ownerWallet)}</span>
            </p>
          </div>
        </aside>

        <section className="tm-card rounded-lg p-4">
          {!wallet.publicKey && (
            <div className="mb-4 rounded-md border border-tm-gold-400/40 bg-tm-gold-200/5 p-4">
              <p className="text-sm text-tm-gold-50">
                Connect your wallet to chat with {character.canonicalName}.
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                You'll be asked to sign a one-time message proving ownership.
              </p>
              <div className="mt-3">
                <WalletMultiButton />
              </div>
            </div>
          )}
          {accessDenied && (
            <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm text-red-300">{error}</p>
              <p className="mt-2 text-xs text-zinc-400">
                Buy ${character.genesisTicker} on Genesis to unlock chat, then refresh.
              </p>
              <a
                href={tradeUrl}
                target="_blank"
                rel="noreferrer"
                className="tm-link-gold mt-2 inline-block text-sm underline"
              >
                Buy on Genesis →
              </a>
            </div>
          )}
          {error && !accessDenied && (
            <div className="mb-2 rounded bg-red-500/10 p-2 text-xs text-red-300">{error}</div>
          )}
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
