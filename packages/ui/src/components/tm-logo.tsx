/**
 * Inline Time Machine logo. Mirrors the SVG shipped at
 * /collection/image.svg but stripped down for header use.
 */
export function TimeMachineLogo({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} aria-hidden>
      <defs>
        <radialGradient id="tm-logo-bg" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#1a1f2e" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
        <linearGradient id="tm-logo-rim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4a574" />
          <stop offset="50%" stopColor="#f5d4a0" />
          <stop offset="100%" stopColor="#a0764e" />
        </linearGradient>
      </defs>
      <circle cx="512" cy="512" r="500" fill="url(#tm-logo-bg)" />
      <g transform="translate(512 512)" stroke="url(#tm-logo-rim)" strokeWidth="40" fill="none">
        <circle r="430" />
        <line x1="0" y1="0" x2="0" y2="-280" strokeLinecap="round" />
        <line x1="0" y1="0" x2="220" y2="120" strokeLinecap="round" strokeWidth="28" />
      </g>
      <circle cx="512" cy="512" r="32" fill="#f5d4a0" />
    </svg>
  );
}
