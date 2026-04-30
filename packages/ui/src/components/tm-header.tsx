'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { TimeMachineLogo } from './tm-logo';

interface NavLinkProps {
  href: string;
  label: string;
  active: boolean;
}

function NavLink({ href, label, active }: NavLinkProps) {
  return (
    <Link
      href={href}
      className={[
        'relative px-1 py-2 transition-colors',
        active ? 'text-tm-gold-50' : 'text-tm-gold-200/70 hover:text-tm-gold-50',
      ].join(' ')}
    >
      {label}
      {active && (
        <span className="absolute -bottom-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-tm-gold-200 to-transparent" />
      )}
    </Link>
  );
}

export function TimeMachineHeader({ showWallet = true }: { showWallet?: boolean }) {
  const pathname = usePathname() ?? '/';
  const isExplore = pathname === '/';
  const isMint = pathname.startsWith('/mint');

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-tm-ink-950/75 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <Link
          href="/"
          className="group flex items-center gap-3"
          aria-label="Time Machine"
        >
          <span className="transition-transform duration-500 group-hover:rotate-[-12deg]">
            <TimeMachineLogo size={36} />
          </span>
          <span className="tm-headline text-lg font-semibold tracking-[0.05em] text-tm-gold-200 sm:text-xl">
            Time Machine
          </span>
        </Link>
        <nav className="flex items-center gap-5 text-sm sm:gap-7">
          <NavLink href="/" label="Explore" active={isExplore} />
          <NavLink href="/mint" label="Mint" active={isMint} />
          {showWallet && <WalletMultiButton />}
        </nav>
      </div>
    </header>
  );
}
