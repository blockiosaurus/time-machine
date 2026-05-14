'use client';

/**
 * Vertical timeline shown during the on-chain mint sequence. Five phases,
 * themed against the Time Machine motif. The active phase shows a small
 * clock-hand inside its dot; done phases fill solid; pending phases sit
 * muted. Connectors fade from gold (done) to ink (pending).
 */

export type MintPhaseKind =
  | 'awaiting-fee'
  | 'pinning'
  | 'awaiting-asset'
  | 'building-genesis'
  | 'awaiting-genesis'
  | 'registering-genesis'
  | 'confirming'
  | 'success';

interface Phase {
  id: 'fare' | 'medallion' | 'portal' | 'registry' | 'arrival';
  title: string;
  hint: string;
  /** Detail line shown when this phase is currently active. */
  detail: (current: MintPhaseKind) => string | null;
}

function makePhases(mintFeeLabel: string): Phase[] {
  return [
  {
    id: 'fare',
    title: 'Pay the fare',
    hint: `${mintFeeLabel} secures your seat in the salon.`,
    detail: (s) => (s === 'awaiting-fee' ? 'Awaiting your signature in the wallet…' : null),
  },
  {
    id: 'medallion',
    title: 'Mint the medallion',
    hint: 'NFT minted and registered with the Agent Registry.',
    detail: (s) => {
      if (s === 'pinning') return 'Pinning prompt + portrait to permanent storage…';
      if (s === 'awaiting-asset') return 'Awaiting your signature to mint the NFT…';
      return null;
    },
  },
  {
    id: 'portal',
    title: 'Open the portal',
    hint: 'Genesis token launched on its bonding curve.',
    detail: (s) => {
      if (s === 'building-genesis') return 'Preparing the Genesis launch transactions…';
      if (s === 'awaiting-genesis') return 'Awaiting your signatures for the Genesis launch…';
      return null;
    },
  },
  {
    id: 'registry',
    title: 'Inscribe the registry',
    hint: 'Genesis indexes the launch and announces it.',
    detail: (s) => (s === 'registering-genesis' ? 'Signing in to Genesis from your wallet…' : null),
  },
  {
    id: 'arrival',
    title: 'Step into the salon',
    hint: 'Your character is ready to converse.',
    detail: (s) => (s === 'confirming' ? 'Confirming the final ledger entries…' : null),
  },
  ];
}

const PHASE_FOR_STEP: Record<MintPhaseKind, Phase['id']> = {
  'awaiting-fee': 'fare',
  pinning: 'medallion',
  'awaiting-asset': 'medallion',
  'building-genesis': 'portal',
  'awaiting-genesis': 'portal',
  'registering-genesis': 'registry',
  confirming: 'arrival',
  success: 'arrival',
};

function phaseStatus(phase: Phase, current: MintPhaseKind, phases: Phase[]): 'done' | 'active' | 'pending' {
  if (current === 'success') return 'done';
  const activeId = PHASE_FOR_STEP[current];
  const order = phases.map((p) => p.id);
  const activeIdx = order.indexOf(activeId);
  const phaseIdx = order.indexOf(phase.id);
  if (phaseIdx < activeIdx) return 'done';
  if (phaseIdx === activeIdx) return 'active';
  return 'pending';
}

export interface MintProgressProps {
  step: MintPhaseKind;
  /** Pre-formatted fee label like "0.25 SOL". Falls back to "the network fee". */
  mintFeeLabel?: string;
}

export function MintProgress({ step, mintFeeLabel }: MintProgressProps) {
  const phases = makePhases(mintFeeLabel ?? 'the network fee');
  const completed = step === 'success';
  return (
    <div className="tm-card relative overflow-hidden rounded-lg p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-[0.3em] text-tm-gold-400/80">
          Aboard the time machine
        </p>
        {completed && (
          <p className="tm-headline text-sm text-tm-gold-50 animate-tm-fade-in">
            Arrived.
          </p>
        )}
      </div>

      <ol className="relative">
        {phases.map((phase, i) => {
          const status = phaseStatus(phase, step, phases);
          const detail = phase.detail(step);
          const isLast = i === phases.length - 1;
          return (
            <li key={phase.id} className="relative pl-12 pb-7">
              {/* Connector line */}
              {!isLast && (
                <span
                  className="absolute left-[14px] top-7 h-full w-px"
                  style={{
                    background:
                      status === 'done'
                        ? 'linear-gradient(180deg, var(--tm-gold-400) 0%, var(--tm-gold-600) 100%)'
                        : status === 'active'
                          ? 'linear-gradient(180deg, var(--tm-gold-400) 0%, rgba(212,165,116,0.15) 100%)'
                          : 'rgba(212,165,116,0.12)',
                  }}
                />
              )}
              {/* Dot */}
              <span
                className={[
                  'absolute left-0 top-0 grid h-7 w-7 place-items-center rounded-full border',
                  status === 'done'
                    ? 'border-tm-gold-400 bg-tm-gold-200 text-tm-ink-950'
                    : status === 'active'
                      ? 'border-tm-gold-400 bg-tm-ink-900 animate-tm-ring-pulse'
                      : 'border-tm-gold-600/40 bg-tm-ink-900/60',
                ].join(' ')}
              >
                {status === 'done' && (
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5">
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                )}
                {status === 'active' && <ClockHand />}
                {status === 'pending' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-tm-gold-600/40" />
                )}
              </span>
              {/* Text */}
              <div>
                <p
                  className={[
                    'tm-headline text-base font-semibold leading-tight',
                    status === 'pending' ? 'text-tm-gold-200/35' : 'text-tm-gold-50',
                  ].join(' ')}
                >
                  {phase.title}
                </p>
                <p
                  className={[
                    'mt-0.5 text-xs leading-snug',
                    status === 'pending' ? 'text-zinc-500/60' : 'text-zinc-400',
                  ].join(' ')}
                >
                  {phase.hint}
                </p>
                {status === 'active' && detail && (
                  <p
                    key={detail}
                    className="mt-2 animate-tm-fade-in text-xs italic text-tm-gold-200"
                  >
                    {detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ClockHand() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-tm-spin-slow">
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--tm-gold-200)" strokeWidth="1.5" />
      <line
        x1="12"
        y1="12"
        x2="12"
        y2="6"
        stroke="var(--tm-gold-200)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="12"
        x2="16"
        y2="14"
        stroke="var(--tm-gold-400)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.5" fill="var(--tm-gold-200)" />
    </svg>
  );
}
