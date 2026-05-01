import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  bigint,
  date,
  unique,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const bytea = customType<{ data: Buffer; default: false; notNull: false }>({
  dataType: () => 'bytea',
});

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    network: text('network').notNull().default('devnet'),
    slug: text('slug').notNull(),
    canonicalName: text('canonical_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    bioSummary: text('bio_summary').notNull(),
    birthYear: integer('birth_year'),
    deathYear: integer('death_year'),
    systemPrompt: text('system_prompt').notNull(),
    promptIpfsCid: text('prompt_ipfs_cid').notNull(),
    portraitIpfsCid: text('portrait_ipfs_cid').notNull(),
    registrationIpfsCid: text('registration_ipfs_cid').notNull(),
    nftMint: text('nft_mint').notNull(),
    agentRegistryId: text('agent_registry_id').notNull(),
    genesisTokenMint: text('genesis_token_mint').notNull(),
    genesisTicker: text('genesis_ticker').notNull(),
    ownerWallet: text('owner_wallet').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text('status').notNull().default('active'),
  },
  (t) => ({
    networkSlug: unique('characters_network_slug_key').on(t.network, t.slug),
    networkCanonical: unique('characters_network_canonical_name_key').on(t.network, t.canonicalName),
    networkNormalized: unique('characters_network_normalized_name_key').on(t.network, t.normalizedName),
    networkNft: unique('characters_network_nft_mint_key').on(t.network, t.nftMint),
    networkGenesisToken: unique('characters_network_genesis_token_mint_key').on(t.network, t.genesisTokenMint),
    networkGenesisTicker: unique('characters_network_genesis_ticker_key').on(t.network, t.genesisTicker),
    normalizedIdx: index('idx_characters_network_normalized').on(t.network, t.normalizedName),
    statusIdx: index('idx_characters_network_status').on(t.network, t.status),
    ownerIdx: index('idx_characters_owner').on(t.ownerWallet),
  })
);

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    ipHash: text('ip_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    iphashIdx: index('idx_sessions_iphash_created').on(t.ipHash, t.createdAt),
    charIdx: index('idx_sessions_character').on(t.characterId),
  })
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessIdx: index('idx_messages_session_created').on(t.sessionId, t.createdAt),
  })
);

export const mintJobs = pgTable(
  'mint_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    network: text('network').notNull().default('devnet'),
    requestedName: text('requested_name').notNull(),
    canonicalName: text('canonical_name'),
    wallet: text('wallet').notNull(),
    status: text('status').notNull().default('pending'),
    error: text('error'),
    steps: jsonb('steps').notNull().default(sql`'{}'::jsonb`),
    portraitBytes: bytea('portrait_bytes'),
    promptText: text('prompt_text'),
    feeSignature: text('fee_signature'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    walletIdx: index('idx_mint_jobs_wallet').on(t.wallet),
    statusIdx: index('idx_mint_jobs_status').on(t.status),
  })
);

export const moderationTickets = pgTable(
  'moderation_tickets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    requester: text('requester').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    charIdx: index('idx_tickets_character').on(t.characterId),
    statusIdx: index('idx_tickets_status').on(t.status),
  })
);

export const spendLog = pgTable(
  'spend_log',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    day: date('day').notNull(),
    characterId: uuid('character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    category: text('category').notNull(),
    costUsdE6: bigint('cost_usd_e6', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({
    unique: unique().on(t.day, t.characterId, t.category),
    dayIdx: index('idx_spend_day').on(t.day),
  })
);
