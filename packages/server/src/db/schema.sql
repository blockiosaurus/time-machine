-- Time Machine database schema (Postgres).
-- Apply via Drizzle migrations or psql -f.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS characters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network               text NOT NULL DEFAULT 'devnet'
    CHECK (network IN ('mainnet', 'devnet', 'testnet')),
  slug                  text NOT NULL,
  canonical_name        text NOT NULL,
  normalized_name       text NOT NULL,
  aliases               text[] NOT NULL DEFAULT '{}',
  bio_summary           text NOT NULL,
  birth_year            int,
  death_year            int,
  system_prompt         text NOT NULL,
  -- Portrait bytes are served from /api/characters/<slug>/portrait — kept
  -- in-DB rather than pinned to Irys so the gallery doesn't depend on Irys
  -- uptime. Same for character metadata / registration JSON, which are
  -- generated on-demand from the row at request time.
  portrait_bytes        bytea,
  portrait_content_type text DEFAULT 'image/png',
  prompt_ipfs_cid       text NOT NULL DEFAULT '',
  portrait_ipfs_cid     text NOT NULL DEFAULT '',
  registration_ipfs_cid text NOT NULL DEFAULT '',
  nft_mint              text NOT NULL,
  agent_registry_id     text NOT NULL,
  genesis_token_mint    text NOT NULL,
  genesis_ticker        text NOT NULL,
  owner_wallet          text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  status                text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'flagged', 'disabled', 'regenerating')),
  -- Uniqueness is scoped per-network so a character minted on devnet
  -- doesn't block the same character from being minted on mainnet.
  UNIQUE (network, slug),
  UNIQUE (network, canonical_name),
  UNIQUE (network, normalized_name),
  UNIQUE (network, nft_mint),
  UNIQUE (network, genesis_token_mint),
  UNIQUE (network, genesis_ticker)
);

-- Network-scoped indexes are created in the migration block at the bottom
-- of this file (after ALTER TABLE ADD COLUMN, so existing tables have the
-- column before the index references it).
CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_wallet);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  ip_hash      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_iphash_created
  ON chat_sessions(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_character
  ON chat_sessions(character_id);

CREATE TABLE IF NOT EXISTS messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created
  ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS mint_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network        text NOT NULL DEFAULT 'devnet'
    CHECK (network IN ('mainnet', 'devnet', 'testnet')),
  requested_name text NOT NULL,
  canonical_name text,
  wallet         text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','canonicalizing','fuzzy_match_failed',
                      'generating','awaiting_fee','fee_paid',
                      'awaiting_sig','on_chain','failed')),
  error          text,
  steps          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Preview artefacts held in DB until finalize uploads them to Irys.
  -- Lets abandoned previews skip the Irys cost entirely.
  portrait_bytes bytea,
  prompt_text    text,
  fee_signature  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mint_jobs_wallet ON mint_jobs(wallet);
CREATE INDEX IF NOT EXISTS idx_mint_jobs_status ON mint_jobs(status);

-- Idempotent column adds for environments that ran an older schema.
ALTER TABLE mint_jobs ADD COLUMN IF NOT EXISTS portrait_bytes bytea;
ALTER TABLE mint_jobs ADD COLUMN IF NOT EXISTS prompt_text    text;
ALTER TABLE mint_jobs ADD COLUMN IF NOT EXISTS fee_signature  text;
ALTER TABLE mint_jobs ADD COLUMN IF NOT EXISTS network        text NOT NULL DEFAULT 'devnet';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS network              text NOT NULL DEFAULT 'devnet';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS portrait_bytes       bytea;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS portrait_content_type text DEFAULT 'image/png';
-- The on-chain Irys CID columns were previously NOT NULL; relax so we can
-- skip Irys entirely. Existing rows already populated these; new rows may
-- leave them empty.
ALTER TABLE characters ALTER COLUMN prompt_ipfs_cid       DROP NOT NULL;
ALTER TABLE characters ALTER COLUMN portrait_ipfs_cid     DROP NOT NULL;
ALTER TABLE characters ALTER COLUMN registration_ipfs_cid DROP NOT NULL;
ALTER TABLE characters ALTER COLUMN prompt_ipfs_cid       SET DEFAULT '';
ALTER TABLE characters ALTER COLUMN portrait_ipfs_cid     SET DEFAULT '';
ALTER TABLE characters ALTER COLUMN registration_ipfs_cid SET DEFAULT '';

-- Refresh the status CHECK constraint to include the new awaiting_fee /
-- fee_paid states. CREATE TABLE IF NOT EXISTS leaves the original
-- constraint in place when the table already exists, so we drop+readd.
ALTER TABLE mint_jobs DROP CONSTRAINT IF EXISTS mint_jobs_status_check;
ALTER TABLE mint_jobs ADD CONSTRAINT mint_jobs_status_check
  CHECK (status IN ('pending','canonicalizing','fuzzy_match_failed',
                    'generating','awaiting_fee','fee_paid',
                    'awaiting_sig','on_chain','failed'));

-- Add the network CHECK constraint idempotently for both tables.
ALTER TABLE mint_jobs DROP CONSTRAINT IF EXISTS mint_jobs_network_check;
ALTER TABLE mint_jobs ADD CONSTRAINT mint_jobs_network_check
  CHECK (network IN ('mainnet', 'devnet', 'testnet'));
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_network_check;
ALTER TABLE characters ADD CONSTRAINT characters_network_check
  CHECK (network IN ('mainnet', 'devnet', 'testnet'));

-- Migrate `characters` uniqueness from (col) to (network, col). Drop the
-- old single-column unique constraints if present, then add composites.
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_slug_key;
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_canonical_name_key;
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_normalized_name_key;
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_nft_mint_key;
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_genesis_token_mint_key;
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_genesis_ticker_key;

ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_network_slug_key;
ALTER TABLE characters ADD CONSTRAINT characters_network_slug_key UNIQUE (network, slug);
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_network_canonical_name_key;
ALTER TABLE characters ADD CONSTRAINT characters_network_canonical_name_key UNIQUE (network, canonical_name);
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_network_normalized_name_key;
ALTER TABLE characters ADD CONSTRAINT characters_network_normalized_name_key UNIQUE (network, normalized_name);
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_network_nft_mint_key;
ALTER TABLE characters ADD CONSTRAINT characters_network_nft_mint_key UNIQUE (network, nft_mint);
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_network_genesis_token_mint_key;
ALTER TABLE characters ADD CONSTRAINT characters_network_genesis_token_mint_key UNIQUE (network, genesis_token_mint);
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_network_genesis_ticker_key;
ALTER TABLE characters ADD CONSTRAINT characters_network_genesis_ticker_key UNIQUE (network, genesis_ticker);

-- Replace single-column lookup indexes with network-scoped composites.
DROP INDEX IF EXISTS idx_characters_normalized;
DROP INDEX IF EXISTS idx_characters_status;
CREATE INDEX IF NOT EXISTS idx_characters_network_normalized ON characters(network, normalized_name);
CREATE INDEX IF NOT EXISTS idx_characters_network_status ON characters(network, status);

CREATE TABLE IF NOT EXISTS moderation_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  requester    text NOT NULL,
  reason       text NOT NULL,
  status       text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_character ON moderation_tickets(character_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON moderation_tickets(status);

-- Spend tracking (per-day aggregates updated by the spend tracker service).
CREATE TABLE IF NOT EXISTS spend_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day          date NOT NULL,
  character_id uuid REFERENCES characters(id) ON DELETE SET NULL,
  category     text NOT NULL,                -- chat_llm | mint_llm | image_gen | irys
  cost_usd_e6  bigint NOT NULL DEFAULT 0,    -- micro-USD to avoid float drift
  UNIQUE(day, character_id, category)
);

CREATE INDEX IF NOT EXISTS idx_spend_day ON spend_log(day);
