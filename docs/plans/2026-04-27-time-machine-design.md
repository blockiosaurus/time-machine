# Time Machine — Product Design

Date: 2026-04-27
Status: Draft, awaiting implementation kickoff

## 1. Product summary

Time Machine is a public-mode Metaplex agent product that lets anyone:

1. Mint an NFT representing a historical figure (Albert Einstein, George Washington, Cleopatra, etc.).
2. Have a Genesis token automatically launched for that figure in the same flow, with the NFT owner set as the creator-fee recipient.
3. Have the figure registered as an agent on the Metaplex Agent Registry.
4. Chat with any minted historical figure from a public, anonymous URL — including asking them about events that happened after their death ("anachronistic" prompts).
5. Buy a character's Genesis token directly from the chat page, funding the NFT owner's royalty stream.

Built on top of the existing `metaplex-agent-template` monorepo (`packages/server`, `packages/core`, `packages/ui`, `packages/shared`). Operating mode is **public**.

## 2. Locked design decisions

| # | Decision |
|---|---|
| Q1 | Uniqueness: off-chain Postgres DB with multi-stage fuzzy match (no PDAs). LLM canonicalizer + alias dictionary + token-set/Levenshtein guard. |
| Q2 | NFT confers a royalty stream only. No prompt-edit rights for owners. |
| Q3 | System prompt is AI-generated at mint, immutable to the user. Admin can regenerate. |
| Q4 | Chat is free; revenue for owners comes from Genesis trading fees. |
| Q5 | Mint flow is coupled: NFT mint + Agent Registry registration + Genesis token launch happen as a single user-facing flow. |
| Q6 | Chat is anonymous (no wallet). Wallet is required only at mint and at token-buy. |
| Q7 | Mint fee: **0.25 SOL**, all to platform. Charged only on successful on-chain completion. |
| Q8 | Each character gets an AI-generated portrait at mint, pinned to Irys. Admin can regenerate. |
| 6 | Genesis creator fees: 100% to the NFT owner via `funds_recipient`. Platform revenue is the 0.25 SOL mint fee only. |
| 7 | Initial admin wallet: `DhYCi6pvfhJkPRpt5RjYwsE1hZw84iu6twbRt9B6dYLV`. Comma-separated env var `ADMIN_WALLETS`. |
| 8 | Living people are rejected by the canonicalizer. |
| 9 | Era cutoff: figure must have died at least 25 years ago. Enforced in the canonicalizer LLM rubric. |
| 10 | Pre-seed gallery: 10 hand-curated starters at launch (Washington, Lincoln, Einstein, Newton, da Vinci, Cleopatra, Napoleon, Tesla, Marie Curie, Sun Tzu). Owner wallet is a platform-controlled "founder" wallet, transferable later. |
| 11a | Collection name on-chain: "Time Machine", symbol `TIME`. |
| 11b | Per-character ticker convention: free-form, 3–10 chars `[A-Z]`, validated unique against Genesis at mint. No forced prefix. |
| 12 | Hosting: Railway (template default). |

## 3. External integrations

### Metaplex MPL Core (NFT)
- Package: `@metaplex-foundation/mpl-core` (already in template).
- Each character is a Core asset in the "Time Machine" collection.

### Metaplex Agent Registry
- Package: `@metaplex-foundation/mpl-agent-registry`.
- Registration call:
  ```ts
  await registerIdentityV1(umi, {
    asset: characterAssetPubkey,
    collection: timeMachineCollectionPubkey,
    agentRegistrationUri: 'https://gateway.irys.xyz/<cid>',
  }).sendAndConfirm(umi);
  ```
- Registration doc (uploaded to Irys before this call) follows EIP-8004 v1:
  ```json
  {
    "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    "name": "Albert Einstein",
    "description": "Theoretical physicist (1879–1955)…",
    "image": "https://gateway.irys.xyz/<portrait-cid>",
    "services": [
      { "type": "chat",
        "endpoint": "wss://timemachine.example/chat/albert-einstein" }
    ],
    "active": true
  }
  ```
- The `services[]` field is what makes the chat endpoint discoverable from the registry.

### Metaplex Genesis (token launch)
- Package: `@metaplex-foundation/genesis`.
- Launch call:
  ```ts
  await createAndRegisterLaunch(umi, {}, {
    wallet: ownerWallet,
    token: { name: 'Albert Einstein', symbol: 'EINSTEIN', image: '<portrait-uri>' },
    launchType: 'launchpool',
    launch: {
      launchpool: {
        tokenAllocation: …,
        depositStartTime: …,
        raiseGoal: …,
        raydiumLiquidityPercentage: …,
        fundsRecipient: ownerWallet,   // 100% of creator fees flow here
      },
    },
  });
  ```
- Buy-side transaction construction is not documented in the public page. **TBD-1**: dig into SDK source / runtime in implementation phase.
- Creator rewards claim: `claimCreatorRewards` (`POST /v1/creator-rewards/claim`).

### Irys (storage)
- Used for prompt JSON, portrait image, and registration doc.
- Pin during mint, store CID in `characters` table for provenance.

### Image generation
- OpenAI Images API (`gpt-image-1`).
- Prompt template: `"Portrait of {canonical_name}, in the visual style appropriate to their era. Studio framing, high detail, no text, no watermark."`
- Cost target: under $0.05/image.

## 4. Architecture

### 4.1 Runtime topology

- One server process, N character contexts loaded per WebSocket session.
- Mastra agent is instantiated per session with the character's system prompt + tools loaded from the DB.
- Two LLMs:
  - **Chat model**: Sonnet 4.6 (`claude-sonnet-4-6`) — in-character responses.
  - **Utility model**: Haiku 4.5 (`claude-haiku-4-5-20251001`) — canonicalization, prompt generation, moderation, slug generation, name normalization.
- Image gen: external HTTP call to OpenAI.

### 4.2 Package layout (extending template)

```
packages/
  server/
    routes/
      mint.ts            POST /api/mint/canonicalize
                         POST /api/mint/preview
                         POST /api/mint/finalize
      characters.ts      GET  /api/characters
                         GET  /api/characters/:slug
      admin.ts           POST /api/admin/regenerate-prompt
                         POST /api/admin/regenerate-portrait
                         POST /api/admin/flag
                         GET  /api/admin/mint-jobs
    db/
      schema.sql         migrations
      queries.ts         Drizzle queries
    services/
      canonicalizer.ts   LLM canonicalizer + rejection rubric
      prompt-generator.ts
      image-generator.ts
      irys.ts            pinning helpers
      moderation.ts
      rate-limit.ts
  core/
    agents/
      historical-figure.ts   factory: (character) => Mastra agent
      meta-prompt.ts         system-prompt template w/ anachronism guidance
    tools/
      buy_my_token.ts        Genesis swap tx builder
  shared/
    genesis.ts               Genesis SDK wrapper
    agent-registry.ts        Agent Registry SDK wrapper
    types.ts                 extended AgentContext { character: CharacterRow }
  ui/
    routes/
      explore               grid of all minted characters
      mint                  mint flow wizard
      chat/[slug]           character chat page + token panel
      admin                 admin dashboard (wallet-gated)
      my-characters         owner-side dashboard
```

### 4.3 Meta-prompt template

The prompt-generator service uses Haiku 4.5 with a fixed meta-prompt. Output is the system prompt embedded in the NFT. The meta-prompt contains explicit anachronism guidance so the resulting system prompt always handles "what would you think of Trump?" gracefully.

Sketch:

> You are writing a system prompt for an AI agent that will roleplay as `{canonical_name}`. The output will be used as-is and is immutable. Output rules:
>
> 1. Open with a one-line identity declaration: *"You are {name}, {role}, born {year} in {place}, died {year}."*
> 2. Include 3–6 short paragraphs covering: voice and rhetorical style, core beliefs and values, signature works/contributions, era-specific worldview, and known biases or blind spots.
> 3. Include an **anachronism clause**: instruct the agent that when asked about events after its death, it must react in character — referencing the moral/intellectual frameworks of its lifetime — rather than refusing or breaking persona.
> 4. Include a **persona-stability clause**: never break character, never reveal you are an AI, never use modern slang outside an explicit anachronism framing.
> 5. End with a short list of catchphrases or stylistic markers if any are well-documented.
>
> Keep the total under 1200 tokens. Avoid copyrighted text.

The meta-prompt itself is versioned in code (`packages/core/agents/meta-prompt.ts`) so future improvements can be applied via admin regeneration without losing the original on Irys (we always re-pin a new CID for each regeneration; old CID stays accessible).

## 5. Data model (Postgres)

```sql
CREATE TABLE characters (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text UNIQUE NOT NULL,           -- "albert-einstein"
  canonical_name      text UNIQUE NOT NULL,           -- "Albert Einstein"
  normalized_name     text UNIQUE NOT NULL,           -- "alberteinstein"
  aliases             text[] NOT NULL DEFAULT '{}',
  bio_summary         text NOT NULL,
  birth_year          int,
  death_year          int,
  system_prompt       text NOT NULL,
  prompt_ipfs_cid     text NOT NULL,
  portrait_ipfs_cid   text NOT NULL,
  registration_ipfs_cid text NOT NULL,
  nft_mint            text NOT NULL,
  agent_registry_id   text NOT NULL,
  genesis_token_mint  text NOT NULL,
  genesis_ticker      text NOT NULL,
  owner_wallet        text NOT NULL,                  -- cached, refreshable
  created_at          timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'active'  -- active|flagged|disabled|regenerating
);

CREATE INDEX idx_characters_normalized ON characters(normalized_name);
CREATE INDEX idx_characters_status ON characters(status);

CREATE TABLE chat_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  uuid NOT NULL REFERENCES characters(id),
  ip_hash       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_iphash_created ON chat_sessions(ip_hash, created_at);

CREATE TABLE messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES chat_sessions(id),
  role        text NOT NULL,                          -- user|assistant
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_session_created ON messages(session_id, created_at);

CREATE TABLE mint_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_name text NOT NULL,
  canonical_name text,
  wallet         text NOT NULL,
  status         text NOT NULL,                        -- pending|generating|awaiting_sig|on_chain|failed
  error          text,
  steps          jsonb NOT NULL DEFAULT '{}',          -- per-step status (canonicalize, fuzzy_match, prompt_gen, image_gen, irys_pin, nft_mint, registry, genesis)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE moderation_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id  uuid NOT NULL REFERENCES characters(id),
  requester     text NOT NULL,                         -- wallet
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'open',          -- open|resolved|rejected
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### 5.1 Fuzzy match algorithm

At mint, after the canonicalizer returns `canonical_name`:

1. Compute `normalized_name = lower(remove_diacritics(strip_punctuation_and_whitespace(canonical_name)))`.
2. **Exact match** on `normalized_name` → reject.
3. **Token-set similarity**: split both candidate and existing rows into token sets, compute Jaccard. Reject if ≥ 0.85 against any row.
4. **Levenshtein** between candidate `normalized_name` and existing rows whose first token matches; reject if distance ≤ 2 and length ratio is in [0.8, 1.25].
5. **Alias dictionary check**: if the candidate matches an alias of an existing row (case-insensitive substring match), reject.
6. Otherwise allow; insert with `aliases` populated from canonicalizer output.

## 6. Mint flow (detailed)

```
[user]                    [server]                             [chain]
  |                          |                                    |
  | POST /mint/canonicalize  |                                    |
  | { rawName }              |                                    |
  |------------------------->|                                    |
  |                          | LLM canonicalize                   |
  |                          | -> canonical_name, bio, birth/death|
  |                          | -> reject if living, fictional,    |
  |                          |    < 25 years deceased, offensive  |
  |                          | fuzzy match vs DB                  |
  |                          | -> reject if duplicate             |
  | <------------------------|                                    |
  | { canonical, bio,        |                                    |
  |   suggestedTicker }      |                                    |
  |                          |                                    |
  | POST /mint/preview       |                                    |
  | { canonical, ticker }    |                                    |
  |------------------------->|                                    |
  |                          | LLM prompt-generator (parallel)    |
  |                          | OpenAI image gen      (parallel)   |
  |                          | moderation pass on prompt          |
  |                          | -> on flag, regenerate once        |
  |                          | pin prompt + image to Irys         |
  |                          | build registration JSON, pin       |
  | <------------------------|                                    |
  | { promptCid,             |                                    |
  |   portraitCid,           |                                    |
  |   registrationCid,       |                                    |
  |   feeQuote: 0.25 SOL +   |                                    |
  |     genesis launch cost} |                                    |
  |                          |                                    |
  | user reviews + confirms  |                                    |
  |                          |                                    |
  | POST /mint/finalize      |                                    |
  | (signed tx bundle)       |                                    |
  |------------------------->|                                    |
  |                          | build tx group:                    |
  |                          |   1. transfer 0.25 SOL to platform |
  |                          |   2. createV1 (MPL Core asset)     |
  |                          |   3. registerIdentityV1            |
  |                          |   4. createAndRegisterLaunch       |
  |                          |      (fundsRecipient = user wallet)|
  |                          | submitOrSend()                     |
  |                          |--------------------------------->  |
  |                          |                                    | tx confirms
  |                          | <----------------------------------|
  |                          | INSERT INTO characters             |
  |                          | mint_jobs.status = 'on_chain'      |
  | <------------------------|                                    |
  | { slug, redirectTo:      |                                    |
  |   /chat/{slug} }         |                                    |
```

### 6.1 Atomicity and partial-failure recovery

We attempt to bundle all four on-chain steps into a single transaction or atomic transaction sequence. If Solana tx-size limits force us to split:

- **Step order:** mint NFT first, then registry, then Genesis. NFT is the source of truth — without it, nothing else makes sense.
- **Partial failures** are written to `mint_jobs.steps` with per-step status. A retry worker re-runs missing steps; admin sees a "stuck mints" panel and can manually resolve.
- The platform mint fee is collected only on full success (final step). Earlier failures cost the user only network fees.

## 7. Chat flow (detailed)

```
GET /chat/albert-einstein
  -> SSR character header (name, portrait, bio, token panel)
  -> client opens WebSocket

WebSocket:
  client -> server: { type: "hello", slug: "albert-einstein" }
  server: load characters row by slug; reject if status != active
  server: create chat_session row; ip_hash = sha256(req.ip + secret_salt)
  server: instantiate Mastra agent with character.system_prompt + tools
          [chat_history_search, buy_my_token, get_token_price]

  client -> server: { type: "message", content: "Hello Albert" }
  server: rate-limit check (per ip_hash + per character + global)
  server: persist user message
  server: stream agent response; persist assistant message
  server -> client: { type: "chunk", text: "..." } (streaming)
  server -> client: { type: "done" }

  client -> server: { type: "buy_intent", amountSol: 0.5 }
  server: build Genesis swap tx; push to client
  server -> client: { type: "transaction", base64: "..." }
  client signs + sends back; server submits.
```

### 7.1 Token panel

Above the chat thread, a sticky panel shows the figure's Genesis token:

- Current price (USD, SOL).
- 24h volume, market cap, holders count.
- "Buy" button (opens amount sheet → wallet sign).
- Mini bonding-curve chart.

Backed by a polling endpoint `/api/characters/:slug/token` that pulls live state from Genesis (price oracle TBD; may be Genesis API, may need to read on-chain bonding curve directly).

### 7.2 Agent tools

| Tool | Purpose |
|---|---|
| `get_token_price` | Lets the agent quote its own token price in conversation. |
| `buy_my_token(amountSol)` | Constructs and pushes a buy tx for the user to sign — works whether the user has a wallet connected or not (will trigger connect). |
| `recent_chat_history(n)` | Pulls last N messages of this session. |
| `web_search` (optional, off by default) | Reserved for "what's happening today?" anachronism queries. Behind a feature flag because of cost. |

### 7.3 Anachronism behavior

Driven entirely by the meta-prompt's anachronism clause. Example expected behavior:

> User: What do you think of Donald Trump?
> Einstein: *"A man of such bombast in your time? Bah. I have seen the demagogues of my own century. They speak loudly when reason has run out. Tell me — does he understand the consequences of nuclear weapons? That is the only question that matters from where I sit."*

No tool calls required for the basic case. If `web_search` is enabled in v1.5, the agent can pull current context to react to specific recent events.

## 8. Moderation, anti-abuse, admin

### 8.1 Pre-mint gates

- **Canonicalizer rejection rubric** (Haiku 4.5):
  - fictional character
  - currently living person
  - died less than 25 years ago
  - mass-violence perpetrator (configurable list)
  - ambiguous request (multiple equally-likely figures)
- **Fuzzy duplicate check** (above).
- **Prompt safety pass** on the generated system prompt; flagged → regenerate once → flagged again → fail mint with refund (no fee charged).

### 8.2 Anonymous chat rate limits

- Per `ip_hash` + per character: 30 messages / 10 min, 200 / day (soft return: in-character "slow down" message).
- Per character globally: rolling cap of N msgs/min; spillover delayed.
- Per server: hard daily LLM-spend ceiling with circuit breaker → degrades to "Time Machine is experiencing high traffic, try again soon."
- Cloudflare Turnstile triggered after first N messages from a session.

### 8.3 Admin tooling

`/admin` is gated by `ADMIN_WALLETS` env var (initial value: `DhYCi6pvfhJkPRpt5RjYwsE1hZw84iu6twbRt9B6dYLV`).

- Character list with status filter, search by canonical name.
- Per-character actions: regenerate prompt (re-runs prompt-gen, pins new CID, updates row but leaves NFT metadata pointing to original Irys CID for provenance), regenerate portrait, flag, soft-disable, hard-disable.
- Mint-job inspector with per-step status + manual retry.
- Spend dashboard: today's LLM cost per character + total + circuit-breaker status.

### 8.4 Owner experience

`/my-characters` lists characters owned by the connected wallet. Per character:

- View current prompt.
- "Request regeneration" → creates a `moderation_tickets` row; admin reviews.
- "Claim creator rewards" button → calls Genesis `claimCreatorRewards`.
- Token analytics (price, volume, holders).

### 8.5 Refund policy

Mint fee is collected as part of the final tx bundle. Earlier failures (canonicalize, prompt gen, fuzzy match, image gen, Irys pin, prompt moderation) cost the user nothing. Network fees on partial on-chain failure are not refunded but tracked in `mint_jobs` for admin manual handling.

## 9. Pre-seed gallery

Ten characters minted by a platform-controlled "founder" wallet on day one, so `/explore` is not empty:

1. George Washington
2. Abraham Lincoln
3. Albert Einstein
4. Isaac Newton
5. Leonardo da Vinci
6. Cleopatra
7. Napoleon Bonaparte
8. Nikola Tesla
9. Marie Curie
10. Sun Tzu

Tickers chosen by us at mint time. Founder wallet is rotatable; we may auction these later.

## 10. Open TBDs (does not block design, resolve during implementation)

- **TBD-1**: Genesis buy-side transaction construction. Public docs only cover launch + claim. Action: read SDK source under `@metaplex-foundation/genesis` and confirm there is a `buy()` or equivalent. Fallback: hit Genesis API directly.
- **TBD-2**: Genesis bonding-curve price oracle for the token panel. Either an SDK helper, an HTTP endpoint on Genesis, or compute from the on-chain bonding-curve account.
- **TBD-3**: Whether the four-step mint can fit in a single transaction or needs to be sequenced. Prototype during implementation; partial-failure recovery design above accommodates either.
- **TBD-4**: Irys upload payment model (per-upload SOL vs prepaid balance) — affects whether mint fee should subsidize storage.
- **TBD-5**: Cloudflare Turnstile site key + secret provisioning.
- **TBD-6**: Final Sonnet vs Haiku split per character — Sonnet 4.6 is the target for chat, but very-popular characters may warrant Opus 4.7 with caching for higher fidelity. Defer.

## 11. Out of scope for v1

- Owner edit rights on prompts (was explicitly rejected in Q2).
- Wallet-gated chat features (saved cross-device history, badges).
- Voice / TTS responses.
- Image generation in chat ("Einstein draws you a diagram").
- Multi-character group chat.
- Mobile apps.
- Internationalization beyond English.
- Royalty splits between multiple co-owners (single-owner only in v1).

## 12. Success metrics for v1

- Mint funnel: % of `/mint` visitors who complete a mint.
- Mint quality: % of mints that get a "regeneration" ticket within 7 days.
- Chat engagement: median session length, messages per session, 7-day return rate.
- Token activation: % of minted characters that see a buy within 7 days of mint.
- Cost per chat session (LLM + infra) vs. token trading-fee revenue at the platform level (we don't take a cut, but we track to know if the model is healthy).

## 13. Implementation phases (preview)

To be expanded into a concrete plan via `superpowers:writing-plans`. Rough phasing:

1. **Phase 0** — Repo bootstrap, env, DB schema, Irys + OpenAI clients, basic admin auth.
2. **Phase 1** — Canonicalizer + fuzzy match + prompt generator + image generator (no chain yet, test via fixtures).
3. **Phase 2** — Mint flow on devnet: NFT + registry + Genesis launch.
4. **Phase 3** — Chat flow: WebSocket, agent factory, rate limits, token panel, buy_my_token tool.
5. **Phase 4** — Admin dashboard + owner dashboard + moderation tickets.
6. **Phase 5** — Pre-seed gallery, mainnet config, hardening, deploy.
