'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import bs58 from 'bs58';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { networkFromRpcUrl, tokenTradeUrl } from '@metaplex-agent/shared/dist/time-machine/links';
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
      <main className="min-h-screen">
        <TimeMachineHeader />
        <div className="mx-auto mt-20 max-w-md px-6 text-center text-tm-gold-200/70">
          <p className="tm-headline text-2xl">Lost in time.</p>
          <p className="mt-2 text-sm text-zinc-400">
            We couldn't find that character.
          </p>
          <Link
            href="/"
            className="tm-link-gold mt-4 inline-block text-sm underline"
          >
            ← Return to the gallery
          </Link>
        </div>
      </main>
    );
  }
  if (!character) {
    return (
      <main className="min-h-screen">
        <TimeMachineHeader />
        <div className="mx-auto mt-20 grid max-w-5xl grid-cols-1 gap-6 px-6 lg:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <div className="tm-skeleton aspect-square w-full rounded-lg" />
            <div className="tm-skeleton h-6 w-3/5 rounded" />
            <div className="tm-skeleton h-4 w-2/5 rounded" />
            <div className="tm-skeleton h-20 w-full rounded" />
          </div>
          <div className="tm-skeleton min-h-[60vh] rounded-lg" />
        </div>
      </main>
    );
  }

  const network = networkFromRpcUrl(
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  );
  const tradeUrl = tokenTradeUrl(network, character.genesisTokenMint);
  const accessDenied = !!error && error.toLowerCase().includes('access');
  const showWalletPrompt = !wallet.publicKey;
  const inputDisabled = showWalletPrompt || accessDenied;
  const inputDisabledReason = showWalletPrompt
    ? 'Connect your wallet to begin…'
    : accessDenied
      ? `Hold $${character.genesisTicker} to chat…`
      : undefined;

  return (
    <main className="min-h-screen">
      <TimeMachineHeader />

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-4">
          {/* Character card */}
          <div className="tm-card overflow-hidden rounded-lg tm-card-rise">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={character.portraitUri}
                alt={character.canonicalName}
                className="aspect-square w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-tm-ink-950/90 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                <h2 className="tm-headline text-2xl font-bold text-tm-gold-50 drop-shadow-md">
                  {character.canonicalName}
                </h2>
                <p className="mt-0.5 text-xs uppercase tracking-widest text-tm-gold-200/90 drop-shadow">
                  {character.birthYear ?? '?'} – {character.deathYear ?? '?'}
                </p>
              </div>
            </div>
            <div className="p-4">
              <p className="text-sm leading-relaxed text-zinc-300">{character.bioSummary}</p>
            </div>
          </div>

          {/* Token panel */}
          <div className="tm-card rounded-lg p-4 tm-card-rise" style={{ animationDelay: '60ms' }}>
            <div className="flex items-baseline justify-between">
              <h3 className="tm-headline text-lg font-semibold text-tm-gold-50">
                ${character.genesisTicker}
              </h3>
              <span className="text-[10px] uppercase tracking-[0.25em] text-tm-gold-400/80">
                Genesis
              </span>
            </div>
            <p className="mt-1 break-all font-mono text-[10px] text-zinc-500">
              {character.genesisTokenMint}
            </p>
            <a
              href={tradeUrl}
              target="_blank"
              rel="noreferrer"
              className="tm-button-primary mt-4 block rounded-md py-2 text-center text-sm"
            >
              Trade on Genesis →
            </a>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
              <svg viewBox="0 0 12 12" className="h-3 w-3 flex-shrink-0 text-tm-gold-400" fill="currentColor">
                <circle cx="6" cy="6" r="2" />
              </svg>
              <span>
                Owner: <span className="font-mono">{shorten(character.ownerWallet)}</span>
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              Holding any ${character.genesisTicker} grants chat access.
            </p>
          </div>

          {/* Status banner — only on real errors, not access-denied (handled inline) */}
          {error && !accessDenied && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 tm-card-rise">
              {error}
            </div>
          )}
          {isReconnecting && (
            <div className="rounded-md border border-tm-gold-400/30 bg-tm-gold-200/5 p-3 text-xs text-tm-gold-200 tm-card-rise">
              Reconnecting…
            </div>
          )}
        </aside>

        <section className="tm-card relative flex min-h-[70vh] flex-col rounded-lg p-2 sm:p-3 tm-card-rise" style={{ animationDelay: '120ms' }}>
          {showWalletPrompt && <WalletGate />}
          {accessDenied && !showWalletPrompt && (
            <AccessDeniedBanner
              ticker={character.genesisTicker}
              tradeUrl={tradeUrl}
            />
          )}
          <ChatPanel
            messages={messages}
            isConnected={isConnected}
            isAgentTyping={isAgentTyping}
            isWalletConnected={!!wallet.publicKey}
            character={character}
            inputDisabled={inputDisabled}
            inputDisabledReason={inputDisabledReason}
            onSendMessage={sendMessage}
          />
        </section>
      </div>
    </main>
  );
}

function WalletGate() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-tm-ink-950/85 backdrop-blur-sm tm-card-rise">
      <div className="max-w-sm px-6 text-center">
        <h3 className="tm-headline text-2xl font-semibold text-tm-gold-50">
          Step inside
        </h3>
        <p className="mt-2 text-sm text-zinc-400">
          Connect a wallet and sign one short message to prove you're allowed in the room.
          You'll only be asked once per session.
        </p>
        <div className="mt-5 flex justify-center">
          <WalletMultiButton />
        </div>
      </div>
    </div>
  );
}

function AccessDeniedBanner({
  ticker,
  tradeUrl,
}: {
  ticker: string;
  tradeUrl: string;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-tm-ink-950/85 backdrop-blur-sm tm-card-rise">
      <div className="max-w-md px-6 text-center">
        <h3 className="tm-headline text-2xl font-semibold text-tm-gold-50">
          A token is required.
        </h3>
        <p className="mt-2 text-sm text-zinc-400">
          Time Machine reserves conversation for the NFT owner and ${ticker} holders.
          Buy any amount of the token to unlock chat for this session.
        </p>
        <a
          href={tradeUrl}
          target="_blank"
          rel="noreferrer"
          className="tm-button-primary mt-5 inline-block rounded-md px-5 py-2"
        >
          Buy ${ticker} on Genesis →
        </a>
        <p className="mt-3 text-[11px] text-zinc-500">
          Refresh this page after your buy confirms.
        </p>
      </div>
    </div>
  );
}

function shorten(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
