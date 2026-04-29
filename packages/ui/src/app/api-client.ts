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
  portraitUrl: string;
  moderation: { ok: boolean; regenerated: boolean };
  mintFeeLamports: number;
  collection: string | null;
}

export interface BuildFeeTxResponse {
  ok: boolean;
  feeTx: { id: 'fee'; base64: string };
  mintFeeRecipient: string;
  mintFeeLamports: number;
}

export interface BuildAssetTxResponse {
  ok: boolean;
  assetAddress: string;
  assetTx: { id: 'create-and-register'; base64: string };
  artefacts: {
    promptCid: string;
    portraitCid: string;
    portraitUri: string;
    registrationCid: string;
    characterMetadataCid: string;
    characterMetadataUri: string;
  };
}

export interface BuildGenesisResponse {
  ok: boolean;
  genesisTokenMint: string;
  genesisAccount: string;
  genesisTxs: Array<{ id: string; base64: string }>;
  /**
   * The CreateLaunchInput the server used. Passed to client-side
   * `registerLaunch` so the user's wallet authenticates the Genesis API
   * call (the agent NFT is owned by the minter, not the server).
   */
  createLaunchInput: unknown;
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
  base: apiBase,
  listCharacters: () => get<{ characters: CharacterSummary[] }>('/api/characters'),
  getCharacter: (slug: string) => get<CharacterSummary>(`/api/characters/${slug}`),

  canonicalize: (rawName: string, wallet: string) =>
    post<CanonicalizeResponse>('/api/mint/canonicalize', { rawName, wallet }),
  preview: (mintJobId: string, ticker: string) =>
    post<PreviewResponse>('/api/mint/preview', { mintJobId, ticker }),

  buildFeeTx: (mintJobId: string, ownerWallet: string) =>
    post<BuildFeeTxResponse>('/api/mint/build-fee-tx', { mintJobId, ownerWallet }),
  buildAssetTx: (mintJobId: string, ownerWallet: string, feeSignature: string) =>
    post<BuildAssetTxResponse>('/api/mint/build-asset-tx', {
      mintJobId,
      ownerWallet,
      feeSignature,
    }),
  buildGenesisTxs: (mintJobId: string, ownerWallet: string, assetSignature: string) =>
    post<BuildGenesisResponse>('/api/mint/build-genesis-txs', {
      mintJobId,
      ownerWallet,
      assetSignature,
    }),
  confirm: (mintJobId: string, ownerWallet: string, genesisSignatures: string[]) =>
    post<{ ok: boolean; character?: { slug: string } }>('/api/mint/confirm', {
      mintJobId,
      ownerWallet,
      genesisSignatures,
    }),
};
