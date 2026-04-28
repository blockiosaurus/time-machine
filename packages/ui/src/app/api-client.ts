/**
 * Time Machine HTTP API client. Targets the same host as the WebSocket
 * server (the server serves both protocols on the same port).
 */

function apiBase(): string {
  if (typeof window === 'undefined') return '';
  const host = process.env.NEXT_PUBLIC_WS_HOST || 'localhost';
  const port = process.env.NEXT_PUBLIC_WS_PORT;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const proto = isLocal ? 'http' : 'https';
  if (proto === 'https' && (!port || port === '443')) return `${proto}://${host}`;
  return `${proto}://${host}:${port ?? (isLocal ? '3002' : '443')}`;
}

export interface CharacterSummary {
  slug: string;
  canonicalName: string;
  bioSummary: string;
  birthYear: number | null;
  deathYear: number | null;
  portraitUri: string;
  nftMint: string;
  genesisTokenMint: string;
  genesisTicker: string;
  ownerWallet: string;
  createdAt: string;
  status: string;
}

export interface CanonicalizeResponse {
  ok: boolean;
  jobId: string;
  reason?: string;
  message?: string;
  existingSlug?: string;
  canonical?: {
    canonicalName: string;
    bioSummary: string;
    birthYear: number | null;
    deathYear: number | null;
    aliases: string[];
    suggestedTicker: string;
  };
  suggestedSlug?: string;
}

export interface PreviewResponse {
  ok: boolean;
  mintJobId: string;
  slug: string;
  portraitUri: string;
  promptCid: string;
  portraitCid: string;
  registrationCid: string;
  characterMetadataCid: string;
  characterMetadataUri: string;
  moderation: { ok: boolean; regenerated: boolean };
  mintFeeLamports: number;
  mintFeeRecipient: string | null;
  collection: string | null;
}

export interface FinalizeResponse {
  ok: boolean;
  assetAddress: string;
  genesisTokenMint: string;
  genesisAccount: string;
  userTransactions: Array<{ id: string; base64: string }>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`);
  return (await res.json()) as T;
}

export const api = {
  listCharacters: () => get<{ characters: CharacterSummary[] }>('/api/characters'),
  getCharacter: (slug: string) => get<CharacterSummary>(`/api/characters/${slug}`),
  canonicalize: (rawName: string, wallet: string) =>
    post<CanonicalizeResponse>('/api/mint/canonicalize', { rawName, wallet }),
  preview: (mintJobId: string, ticker: string) =>
    post<PreviewResponse>('/api/mint/preview', { mintJobId, ticker }),
  finalize: (mintJobId: string, ownerWallet: string) =>
    post<FinalizeResponse>('/api/mint/finalize', { mintJobId, ownerWallet }),
  confirm: (mintJobId: string, signatures: string[]) =>
    post<{ ok: boolean; character?: { slug: string } }>('/api/mint/confirm', {
      mintJobId,
      signatures,
    }),
};
