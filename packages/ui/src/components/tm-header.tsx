'use client';

import Link from 'next/link';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { TimeMachineLogo } from './tm-logo';

export function TimeMachineHeader({ showWallet = true }: { showWallet?: boolean }) {
  return (
    <header className="border-b border-white/5 bg-tm-ink-950/60 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <TimeMachineLogo size={36} />
          <span className="tm-headline text-xl font-semibold tracking-wide text-tm-gold-200">
            Time Machine
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className="tm-link-gold">Explore</Link>
          <Link href="/mint" className="tm-link-gold">Mint</Link>
          {showWallet && <WalletMultiButton />}
        </nav>
      </div>
    </header>
  );
}
