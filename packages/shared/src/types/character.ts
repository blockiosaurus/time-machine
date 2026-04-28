export type CharacterStatus = 'active' | 'flagged' | 'disabled' | 'regenerating';

export interface CharacterRow {
  id: string;
  slug: string;
  canonicalName: string;
  normalizedName: string;
  aliases: string[];
  bioSummary: string;
  birthYear: number | null;
  deathYear: number | null;
  systemPrompt: string;
  promptIpfsCid: string;
  portraitIpfsCid: string;
  registrationIpfsCid: string;
  nftMint: string;
  agentRegistryId: string;
  genesisTokenMint: string;
  genesisTicker: string;
  ownerWallet: string;
  createdAt: Date;
  status: CharacterStatus;
}

export type MintJobStatus =
  | 'pending'
  | 'canonicalizing'
  | 'fuzzy_match_failed'
  | 'generating'
  | 'awaiting_sig'
  | 'on_chain'
  | 'failed';

export interface MintJobStep {
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface MintJobSteps {
  canonicalize?: MintJobStep;
  fuzzy_match?: MintJobStep;
  prompt_gen?: MintJobStep;
  image_gen?: MintJobStep;
  irys_pin?: MintJobStep;
  nft_mint?: MintJobStep;
  registry?: MintJobStep;
  genesis?: MintJobStep;
}

export interface MintJobRow {
  id: string;
  requestedName: string;
  canonicalName: string | null;
  wallet: string;
  status: MintJobStatus;
  error: string | null;
  steps: MintJobSteps;
  createdAt: Date;
  updatedAt: Date;
}

/** Persisted on mint_jobs.steps.canonicalizer.result for replay-free preview. */
export interface PersistedCanonicalizerResult {
  canonicalName: string;
  bioSummary: string;
  birthYear: number | null;
  deathYear: number | null;
  aliases: string[];
  suggestedTicker: string;
}

export interface CanonicalizerResult {
  ok: true;
  canonicalName: string;
  bioSummary: string;
  birthYear: number | null;
  deathYear: number | null;
  aliases: string[];
  suggestedTicker: string;
}

export interface CanonicalizerRejection {
  ok: false;
  reason:
    | 'fictional'
    | 'living'
    | 'too_recent'
    | 'mass_violence'
    | 'ambiguous'
    | 'not_found'
    | 'policy';
  message: string;
}

export type CanonicalizerResponse = CanonicalizerResult | CanonicalizerRejection;

export interface ModerationTicketRow {
  id: string;
  characterId: string;
  requester: string;
  reason: string;
  status: 'open' | 'resolved' | 'rejected';
  createdAt: Date;
}
