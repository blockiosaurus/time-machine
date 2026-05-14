'use client';

import { useEffect, useState } from 'react';
import { api, type ServerConfig } from '../app/api-client';

let cached: ServerConfig | null = null;
let inflight: Promise<ServerConfig> | null = null;

/**
 * Fetch /api/config exactly once across the app lifetime, then hand the
 * cached value to every caller. Lets components render dynamic copy
 * (mint fee in SOL, network label) without hardcoding env values in the
 * frontend.
 */
export function useServerConfig(): ServerConfig | null {
  const [cfg, setCfg] = useState<ServerConfig | null>(cached);

  useEffect(() => {
    if (cached) {
      setCfg(cached);
      return;
    }
    if (!inflight) {
      inflight = api.getConfig().then((c) => {
        cached = c;
        return c;
      });
    }
    let cancelled = false;
    inflight.then((c) => {
      if (!cancelled) setCfg(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return cfg;
}

/** Format lamports as a human-readable SOL string ("0.25 SOL"). */
export function formatSol(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  // Trim trailing zeros: 0.25 → "0.25", 1 → "1", 0.001 → "0.001"
  const str = sol.toFixed(9).replace(/\.?0+$/, '');
  return `${str} SOL`;
}
