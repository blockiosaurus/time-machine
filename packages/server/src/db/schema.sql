-- Time Machine database schema (Postgres).
-- Apply via Drizzle migrations or psql -f.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS characters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text UNIQUE NOT NULL,
  canonical_name        text UNIQUE NOT NULL,
  normalized_name       text UNIQUE NOT NULL,
  aliases               text[] NOT NULL DEFAULT '{}',
  bio_summary           text NOT NULL,
  birth_year            int,
  death_year            int,
  system_prompt         text NOT NULL,
  prompt_ipfs_cid       text NOT NULL,
  portrait_ipfs_cid     text NOT NULL,
  registration_ipfs_cid text NOT NULL,
  nft_mint              text NOT NULL UNIQUE,
  agent_registry_id     text NOT NULL,
  genesis_token_mint    text NOT NULL UNIQUE,
  genesis_ticker        text NOT NULL UNIQUE,
  owner_wallet          text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  status                text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'flagged', 'disabled', 'regenerating'))
);

CREATE INDEX IF NOT EXISTS idx_characters_normalized ON characters(normalized_name);
CREATE INDEX IF NOT EXISTS idx_characters_status ON characters(status);
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

-- Refresh the status CHECK constraint to include the new awaiting_fee /
-- fee_paid states. CREATE TABLE IF NOT EXISTS leaves the original
-- constraint in place when the table already exists, so we drop+readd.
ALTER TABLE mint_jobs DROP CONSTRAINT IF EXISTS mint_jobs_status_check;
ALTER TABLE mint_jobs ADD CONSTRAINT mint_jobs_status_check
  CHECK (status IN ('pending','canonicalizing','fuzzy_match_failed',
                    'generating','awaiting_fee','fee_paid',
                    'awaiting_sig','on_chain','failed'));

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
