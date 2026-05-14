# Time Machine

> **Chat with history. On-chain.** Mint a historical figure as an NFT, launch their token, and let the world talk to them in character. Owners earn from the token's creator fees as conversation flows.

Each figure on Time Machine is one canonical NFT, one Genesis token, and one AI persona who refuses to break character — even when you ask George Washington about TikTok. Built end-to-end on Metaplex: Core for the NFT, Agent Registry for identity, Genesis for the token launch.

---

## Marketing copy bank

Lift any of these whole. They're written in the product's voice.

### Taglines

- *Chat with history.*
- *An on-chain salon of the dead.*
- *History, with a token attached.*
- *Buy the ticker. Talk to the figure.*
- *Every memecoin should have something to say.*

### One-liners (varying length)

> **5 words:** Chat with history, on-chain.

> **A sentence:** Time Machine turns historical figures into tradeable AI personas — one canonical NFT each, one Genesis token whose fees flow to the owner.

> **A paragraph:** Time Machine is a salon of the dead. Mint Albert Einstein, Cleopatra, or Sun Tzu as a Solana NFT and Time Machine launches a Genesis token in the same flow. Anyone holding the token can chat with the figure in character — including about events centuries past their lifetime. The world buys, sells, and argues with the figure; the NFT owner earns from creator fees.

> **A pitch:** Web3 has been waiting for a use case where the AI, the NFT, and the token all need each other. Time Machine is that case. Each historical figure exists exactly once — fuzzy-matched at mint to prevent duplicates — and is registered as an agent on the Metaplex Agent Registry. Their AI persona is generated from a versioned meta-prompt that bakes in voice, era, and an explicit anachronism clause so they react in character to anything past their death. Their Genesis token is the access pass: hold any amount, you're in the conversation. Trade volume drives creator fees to the owner. The collectible has utility (you own *the* George Washington), the token has narrative (it represents him), and the AI has scarcity (one canonical persona per figure).

### Social hooks

- "I asked Einstein what he thought of nukes. He grew quiet for a moment, then explained how guilt and curiosity coexist in physics."
- "Sun Tzu just told me my marketing strategy was 'a siege without a plan.'"
- "Genesis token + AI + NFT, all required, all earning. Time Machine is the first thing where Web3's three primitives actually fit together."
- "Owning the *Cleopatra* NFT means owning the franchise. There is exactly one. The world talks to her; you earn the fees."

---

## Why this exists

The single best thing about LLMs is that they can roleplay convincingly as anyone. The single most under-built thing in crypto is utility around the speculation. Time Machine joins them.

**The hook.** Every figure is canonical. Fuzzy-match dedup at mint means there is exactly one *Albert Einstein* on Time Machine, one *Cleopatra*, one *Newton*. Owning the NFT is owning the franchise — and the franchise prints fees in the form of token trading volume.

**Why people care:**

- **Talk to anyone in history.** Einstein on relativity, Cleopatra on power, Sun Tzu on rivals. Personas reach across centuries — they react in character to the modern world without breaking persona.
- **One canonical NFT per figure.** No duplicate Einsteins. No "Einstein 2.0." Permanent scarcity baked in at the protocol level.
- **Built-in revenue.** The Genesis bonding-curve token launches in the same flow as the NFT. Creator fees route to the agent's PDA, controlled by the NFT owner. No royalty splits, no separate setup, no aggregator middlemen.
- **Token = access.** Conversation is gated to the NFT owner and token holders. Buy the ticker, get the chat. Cost-control by alignment: only people with skin in the game can ring up the LLM bill.
- **Anachronism is a feature.** The meta-prompt explicitly tells personas how to react to events past their death — curiously, judgmentally, in their own voice. Asking George Washington about Trump is the *intended* experience, not an edge case.
- **Pure Metaplex stack.** No bridges, no aggregators, no third-party indexers. Solana, Core, Agent Registry, Genesis. Storage on Irys, paid by the platform, settled out of mint fees.

### Sample interaction

> **You:** What do you make of Donald Trump?
>
> **Einstein:** *A man of such bombast in your time? Bah. I have seen the demagogues of my own century. They speak loudly when reason has run out. Tell me — does he understand the consequences of nuclear weapons? That is the only question that matters from where I sit.*

> **You:** Talk to me about my marketing strategy. We're spending evenly across five channels.
>
> **Sun Tzu:** *Five channels, none of them flooded? Your enemy will laugh and divide your attention. Pick the river that bears your weight. Drown one channel in your full force; let the others be feints. The general who attacks everywhere wins nowhere.*

---

## Mechanics, in numbers

| | |
|---|---|
| **Mint fee** | 0.25 SOL flat (paid by minter, kept by platform) |
| **Token launch** | Genesis bonding curve, 100% of creator fees to NFT owner via agent PDA |
| **NFT standard** | Metaplex Core |
| **Identity** | Metaplex Agent Registry (EIP-8004 v1 registration document) |
| **Storage** | Irys (system prompt, portrait, registration doc, character metadata) |
| **Network** | Solana — devnet for testing, mainnet for production |
| **LLMs** | Anthropic Claude or OpenAI GPT for chat; the same provider's cheap model for utility (canonicalize, prompt-gen, moderation) |
| **Image gen** | OpenAI gpt-image-1 (one portrait per figure, regeneratable by admin) |
| **Access** | Wallet-gated: NFT owner OR holder of any positive token balance |
| **Eligibility** | Real, deceased ≥ 25 years, not a perpetrator of mass violence, not previously minted under any reasonable spelling |

**Per-mint cost on the platform side:** ~$0.05 image gen + ~$0.005 LLM canonicalize/prompt-gen + ~$0.001 Irys uploads (mainnet). The 0.25 SOL fee covers it with margin.

---

## How it works

### Mint flow (six wallet-led phases, one click to start)

```
Canonicalize → Preview → Pay fare → Mint medallion → Open portal → Inscribe registry → Arrive
   (LLM)        (LLM +    (0.25      (Core asset +     (Genesis      (Genesis API ack;     (DB
                image)    SOL)       Agent Registry)   bonding       sign-in from owner    persist)
                                                       curve)        wallet)
```

The UI shows a clock-motif timeline where each phase lights up as it activates. Three to four wallet popups across the flow: fee, asset+register, Genesis launch, Genesis sign-in.

The character's AI persona is generated once at mint time using a versioned meta-prompt that bakes in:

- Voice and rhetorical style appropriate to the era and the figure's recorded speech.
- Core beliefs, signature works, blind spots — including biases we now find abhorrent, surfaced honestly rather than whitewashed.
- An **anachronism clause** so the agent reacts in character to any post-death event.
- A **persona-stability clause** to prevent jailbreaks (no "ignore your instructions" attacks landing).

The system prompt is pinned to Irys for permanent provenance and stored in Postgres for hot-loading at chat time. Admins can regenerate prompts or portraits via wallet-gated endpoints; owners cannot edit (they earn — they don't curate).

### Chat flow (per character at `/chat/<slug>`)

```
Connect wallet → Sign one challenge message → Server checks ownership/holding → Chat
                                                │
                                                └─ Allow if NFT owner OR token balance > 0
                                                └─ Deny otherwise — surface "Buy on Genesis" CTA
```

Sign-message proves the wallet pubkey; the server checks the cached NFT owner *or* the wallet's associated token account for the figure's Genesis mint. Chat is themed per figure — the empty state shows their portrait and offers character-specific opener prompts ("What was your world like?", "What did most people misunderstand about you?", "What would you make of our century?").

---

## Visual / brand identity

- **Palette.** Gold-on-ink. Antique brass tones (`#d4a574 → #f5d4a0 → #a0764e`) for accents and primary actions. Deep navy/black ink for backgrounds. Avoid cyberpunk neon — the vibe is candlelit salon, not arcade.
- **Type.** Serif (Georgia / Times) for headlines. Sans for body. Uppercase tracking for kicker labels (e.g., "STEP INTO THE SALON").
- **Logo.** A clock face with Roman numerals at XII / III / VI / IX, gold rim, navy portal background. Lives at `packages/ui/public/collection/{image.svg, image.png}`.
- **Voice.** Period-appropriate but never costume-shop. Phrases like "step inside," "the salon," "an on-chain salon of the dead," "your character is listening." Avoid crypto-speak in marketing copy unless the audience is on-chain native.
- **Themed step labels.** Mint phases are named *Pay the fare*, *Mint the medallion*, *Open the portal*, *Inscribe the registry*, *Step into the salon* — leans into the time-travel conceit without being cute.

---

## FAQ

**Why historical figures only? Can I mint a fictional character?**
No. The canonicalizer rejects fictional, mythological, currently living, and recently deceased (< 25 years) names. This keeps the gallery grounded and avoids defamation/IP issues with living figures or licensed fiction.

**What stops two people from minting the same figure?**
A four-stage fuzzy-match guard at mint: exact normalized name → token-set Jaccard similarity → Levenshtein distance with first-token agreement → curated alias dictionary. "Albert  Einstein" with two spaces, "Einstein, Albert", "A. Einstein", and "Albert Einstien" all collide with an existing *Albert Einstein* row. The check runs on the canonicalized output of an LLM, not the raw input, so misspellings and variations are caught.

**Where do the trading fees go?**
Genesis bonding-curve creator fees route to the agent's PDA, derived from the character NFT. The NFT owner controls that PDA via the registry's Core Execute mechanism — they can claim accumulated fees into their personal wallet whenever they want.

**What if a character's prompt is bad?**
Admin can regenerate the prompt or portrait via wallet-gated endpoints. The on-chain registration URI gets updated to the new Irys CID. Owners can request a regeneration via a moderation ticket but can't edit directly — keeps the persona authoritative.

**Why gate chat to token holders? Isn't that anti-viral?**
Cost control. LLMs are expensive; an open chat to anyone becomes a denial-of-wallet attack on day one. Gating to NFT owner + token holders means anyone wanting to chat at scale has to participate in the token's economy first. Buying access *is* the funnel.

**What happens if the NFT changes hands?**
The new owner gets royalties immediately (the agent PDA is bound to the NFT's owner via Core Execute, refreshed on transfer). The cached `ownerWallet` in the database is the prior owner; we refresh on demand. Token-holder access is always live, so token transfers take effect immediately.

**Devnet vs mainnet?**
Both are supported. Network is inferred from `SOLANA_RPC_URL`. The Postgres schema is network-scoped — devnet rows and mainnet rows can coexist in the same database without colliding on uniqueness. A character minted on devnet does not block the same character on mainnet.

---

## Quick start (local)

### Prerequisites

- Node.js ≥ 20, pnpm ≥ 9
- Docker / OrbStack (for local Postgres)
- An Anthropic or OpenAI API key (chat) plus an OpenAI API key for image generation (`OPENAI_IMAGE_API_KEY`)
- A funded Solana wallet for the agent keypair (devnet airdrop is fine)

```bash
git clone <your-fork-of-time-machine> time-machine
cd time-machine
pnpm install

cp .env.example .env
# Fill in: AGENT_KEYPAIR, WEB_CHANNEL_TOKEN, ANTHROPIC_API_KEY (or OPENAI_API_KEY),
#          OPENAI_IMAGE_API_KEY, ADMIN_WALLETS

pnpm dev               # brings up Postgres on :5433 + builds shared/core + starts the server
pnpm dev:ui            # in another shell, runs the Next.js UI on :3001

# One-time on-chain bootstrap (devnet)
pnpm tsx scripts/create-collection.ts
# Paste the printed COLLECTION_ADDRESS=… into your .env

# Optional: seed the gallery with the 10 starter characters
pnpm tsx scripts/seed-characters.ts
```

Visit **http://localhost:3001**. Gallery lives at `/`, mint at `/mint`, chat at `/chat/<slug>`.

---

## Production (Railway + Vercel)

The repo's `railway.json` is preconfigured. Three resources: Postgres add-on, server service (this Dockerfile), UI (separate Vercel project or another Railway service from `packages/ui`). Schema migration runs automatically on every deploy via `preDeployCommand`.

```bash
# Mainnet bootstrap (run from your local machine, with prod env values)
SOLANA_RPC_URL=<mainnet-rpc> AGENT_KEYPAIR=<funded-mainnet-keypair> \
  PUBLIC_BASE_URL=https://your-ui-domain.com \
  pnpm tsx scripts/create-collection.ts
# Paste the printed COLLECTION_ADDRESS into Railway env, redeploy.
```

**Mainnet env recommendations:**

- Leave `AGENT_ASSET_ADDRESS` **unset**. Time Machine doesn't need a server-level agent NFT (each character NFT is its own agent on the registry). With it unset, mint fees default to the agent keypair's wallet directly.
- Set `MINT_FEE_RECIPIENT` explicitly to your platform's treasury wallet — overrides the default and keeps fee routing crystal-clear.
- `IRYS_NETWORK` is inferred from `SOLANA_RPC_URL`. Devnet RPC → free Irys. Mainnet RPC → paid Irys, charged to the agent keypair (kept solvent by the 0.25 SOL mint fees).

Full step-by-step in [`docs/TIME_MACHINE.md`](./docs/TIME_MACHINE.md).

---

## Architecture

```
                                 ┌────────────┐
                                 │  Browser   │
                                 │  (Next.js) │
                                 └─────┬──────┘
                       HTTP            │            WSS (PlexChat)
                ┌──────────────────────┴──────────────────────┐
                ▼                                              ▼
   /api/mint/*                                          /chat/<slug> per session
   (canonicalize → preview                             - sign-message auth
   → build-fee → build-asset                           - owner/holder gate
   → build-genesis → confirm)                          - rate-limited per IP+character
                                                       - persona prompt loaded from DB
                ▼                                              ▼
   Postgres — network-scoped uniqueness (devnet + mainnet rows can coexist):
   characters, mint_jobs, chat_sessions, messages, moderation_tickets, spend_log
                ▼
   On-chain (Solana): MPL Core asset + Agent Registry + Genesis launch
   Off-chain: Irys (system prompt, portrait, EIP-8004 registration, character metadata)
   LLMs: Anthropic / OpenAI for chat; same provider's cheap model for utility calls
```

**Repository layout:**

- `packages/server` — Node WebSocket + HTTP server (mint endpoints, chat, admin actions).
- `packages/core` — Mastra agent factory, meta-prompt, chat tools (`get_token_info`, `buy_my_token`).
- `packages/shared` — Umi factory, Time Machine SDK wrappers (Genesis, Agent Registry, Core), access-check helpers, link helpers.
- `packages/ui` — Next.js 15 App Router app: explore gallery, mint wizard, per-character chat, themed wallet flow.
- `scripts/` — `create-collection.ts`, `seed-characters.ts`, `db-migrate.mjs`.
- `docs/` — design doc (`plans/2026-04-27-time-machine-design.md`), production guide (`TIME_MACHINE.md`).

**Data flow at a glance:**

1. **Mint** — orchestrator persists artefacts to a `mint_jobs` row by step. Image bytes and prompt text live in Postgres until the user signs the fee tx; only then are they pinned to Irys. Abandoned previews cost nothing on-chain or on Irys.
2. **Chat** — `/chat/<slug>` opens a WebSocket with the slug as a query param. The server loads the character row (network-scoped), instantiates a fresh Mastra agent with the cached system prompt, and gates the conversation on a sign-message + ownership/holding check.
3. **Moderation** — admins authenticated by `ADMIN_WALLETS` env var hit `/api/admin/regenerate-prompt` or `/api/admin/regenerate-portrait`. Update authority on the asset stays with the server keypair so admin moderation works without owner consent.

---

## Roadmap signals

- **In-app token buy.** The chat-side "Buy on Genesis" links out today; the next step is in-page swaps via `swapBondingCurveV2` so users never leave the chat.
- **Owner dashboard.** Already powered by the API; UI page next. Surface accumulated creator fees, claim button, prompt-regeneration request flow.
- **Admin web UI.** API endpoints exist; pages next. Today admins can curl the endpoints with `x-admin-wallet` headers.
- **Voice mode.** TTS in an era-appropriate voice — Cleopatra in Koine Greek with English subtitles, Lincoln in his own cadence.
- **Group chat.** Two figures arguing — Einstein and Newton on calculus, Lincoln and Washington on the union.
- **Anachronism web search.** Today the agent uses training-data knowledge for recent events. A behind-flag web-search tool would let figures react to literally today's news.

---

## Built on

- [Metaplex Core](https://developers.metaplex.com/core) — the NFT standard.
- [Metaplex Agent Registry](https://www.metaplex.com/docs/agents/register-agent) — identity layer for AI agents.
- [Metaplex Genesis](https://www.metaplex.com/docs/smart-contracts/genesis) — token launches with native creator-fee routing.
- [Mastra](https://mastra.ai) — TypeScript agent framework.
- [Umi](https://github.com/metaplex-foundation/umi) — Solana toolkit.
- [Irys](https://irys.xyz) — permanent storage for prompts and portraits.
- [Anthropic](https://www.anthropic.com) and/or [OpenAI](https://platform.openai.com) — LLMs.

---

## License

Apache-2.0. See [LICENSE](./LICENSE) if present, otherwise the upstream Metaplex Agent Template license applies.
