# Time Machine

> An on-chain salon of the dead. Mint a historical figure as an NFT, launch their Genesis token, and let the world chat with them in character. Owners earn from the token's creator fees as the world talks to their figure.

Each figure on Time Machine is one canonical NFT, one Genesis token, and one AI persona who refuses to break character — even when you ask George Washington about TikTok.

---

## The pitch (for marketing)

**One-liner.** Chat with history, on-chain. Time Machine turns historical figures into AI-backed NFTs whose creator fees flow to the NFT owner.

**The hook.** Every character is canonical (no two Albert Einsteins), tied to a Solana NFT in the *Time Machine* Metaplex Core collection, and paired with a Genesis bonding-curve token. Conversation is gated to the NFT owner and holders of that figure's token. The owner earns SOL from creator fees as the world buys, sells, and talks to their figure.

**Why people care.**
- **Talk to anyone in history.** Einstein on relativity, Cleopatra on power, Sun Tzu on rivals. Every persona is generated from a curated meta-prompt with explicit anachronism guidance — they react in character to anything past their lifetime.
- **One canonical NFT per figure.** Fuzzy-match dedup at mint time means there is exactly one *Albert Einstein*. Owning it is owning the franchise.
- **Built-in revenue.** A Genesis bonding-curve token launches with every mint. Creator fees flow to the NFT owner via the agent's PDA — no separate setup, no royalty splits to manage.
- **Scarcity by design.** Mint requires the figure to be real, deceased ≥ 25 years, and not previously minted under any reasonable spelling.
- **Pure Metaplex stack.** Core (NFT), Agent Registry (identity), Genesis (token launch). No bridges, no aggregators, no third-party indexers.

**Numbers and primitives.**
- Mint fee: **0.25 SOL** flat.
- Network: **Solana**, devnet or mainnet.
- NFT standard: **Metaplex Core**.
- Token standard: **Metaplex Genesis** bonding curve.
- Identity: **Metaplex Agent Registry** (EIP-8004 v1 registration document).
- LLM: **Anthropic** or **OpenAI** for chat; cheap utility model for canonicalization, prompt generation, and moderation.
- Storage: **Irys** (system prompt, portrait, registration doc, metadata).

**Access model.** Chat with a figure requires the connecting wallet to either (a) own that figure's NFT or (b) hold any positive amount of its Genesis token. Owners can chat freely; everyone else has to buy in. Cost-control by alignment: only people with skin in the game can ring up the LLM bill.

**Audience.** Memecoin traders who want a story behind the ticker. NFT collectors who want utility beyond a JPEG. History nerds who want to argue with Newton.

---

## How it works

```
   Mint flow (one user click → 3 wallet popups)
   ─────────────────────────────────────────────
   Canonicalize  →  Preview  →  Pay fee  →  Mint NFT + Register agent
   (LLM)            (LLM +       (0.25       (user-paid; server retains
   fuzzy match)     image gen)   SOL)        update authority for moderation)
                                              │
                                              ▼
                                    Launch Genesis token (bonding curve)
                                              │
                                              ▼
                                    Register launch with Genesis API
                                    (user wallet authenticates)

   Chat flow (per character at /chat/<slug>)
   ─────────────────────────────────────────
   Connect wallet  →  Sign challenge  →  Server checks ownership/holding  →  Chat
                                          │
                                          └─ Allow if NFT owner OR token balance > 0
                                          └─ Deny otherwise (CTA: buy on Genesis)
```

The character's AI persona is generated once at mint time using a versioned meta-prompt that bakes in:
- Voice and rhetorical style appropriate to the era.
- Core beliefs, signature works, blind spots.
- An **anachronism clause** so the agent reacts in character to any post-death event.
- A **persona-stability clause** to prevent jailbreaks.

The system prompt is pinned to Irys for permanent provenance and stored in the database for hot-loading at chat time. Admins can regenerate prompts or portraits via wallet-gated endpoints; owners cannot edit (they earn — they don't curate).

---

## Quick start

### Prerequisites
- Node.js ≥ 20, pnpm ≥ 9
- Postgres (locally via OrbStack/Docker; in prod via Railway add-on)
- Anthropic or OpenAI API key (chat) + OpenAI API key (image generation)
- A funded Solana wallet for the agent keypair (devnet airdrop or a real wallet)

### Local dev

```bash
# 1. clone + install
git clone <your-fork-of-time-machine> time-machine
cd time-machine
pnpm install

# 2. set env (see .env.example for the full list — most have sensible defaults)
cp .env.example .env
#    fill in: AGENT_KEYPAIR, WEB_CHANNEL_TOKEN, ANTHROPIC_API_KEY (or OPENAI_API_KEY),
#             OPENAI_IMAGE_API_KEY, ADMIN_WALLETS

# 3. start Postgres (auto-seeded via docker-compose) + the server
pnpm dev               # brings up Postgres on :5433 + builds shared/core + starts server
pnpm dev:ui            # in another shell, runs the Next.js UI on :3001

# 4. one-time bootstrap of the on-chain collection (devnet)
pnpm tsx scripts/create-collection.ts
#    paste the printed COLLECTION_ADDRESS=… into your .env

# 5. (optional) seed the gallery with the 10 starter characters
pnpm tsx scripts/seed-characters.ts
```

Visit http://localhost:3001 — gallery is at `/`, mint at `/mint`, chat at `/chat/<slug>`.

### Production (Railway)

1. Create a Railway project, add a Postgres add-on, deploy this repo as a Dockerfile service. `railway.json` is preconfigured to run `node scripts/db-migrate.mjs` as a `preDeployCommand` (idempotent schema migrations).
2. Set the env vars on the server service (see `docs/TIME_MACHINE.md` for the full list).
3. Deploy the UI separately to Vercel (the server's Dockerfile excludes the UI build). Point `NEXT_PUBLIC_WS_HOST` at your Railway server's domain, set `NEXT_PUBLIC_WS_TOKEN` to the same `WEB_CHANNEL_TOKEN` as the server.
4. Edit `packages/ui/public/collection/metadata.json` to use your domain so the on-chain collection metadata resolves, then run `pnpm tsx scripts/create-collection.ts` against prod RPC + keypair.
5. Optionally seed the gallery via `scripts/seed-characters.ts`.

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
   /api/mint/* (canonicalize → preview                 /chat/<slug> per session
   → build-fee → build-asset → build-genesis           - owner/holder gate
   → confirm)                                          - rate limited per IP+character
                                                       - persona prompt loaded from DB
                ▼                                              ▼
   Postgres (mint_jobs, characters, sessions, messages, moderation_tickets, spend_log)
                ▼
   On-chain (Solana): MPL Core asset + Agent Registry + Genesis launch
   Off-chain: Irys (prompt JSON, portrait, EIP-8004 registration, character metadata)
   LLMs: Anthropic / OpenAI for chat; same provider's cheap model for utility calls
```

### Repository layout
- `packages/server` — Node WebSocket + HTTP server (mint endpoints, chat, admin).
- `packages/core` — Mastra agent factory + meta-prompt + chat tools (`get_token_info`, `buy_my_token`).
- `packages/shared` — Umi factory, time-machine SDK wrappers (Genesis, Agent Registry, Core), access-check helpers.
- `packages/ui` — Next.js 15 app (App Router) for the public site + mint wizard + chat.
- `scripts/` — bootstrap (`create-collection.ts`), seed (`seed-characters.ts`), migrate (`db-migrate.mjs`).
- `docs/` — design doc (`plans/2026-04-27-time-machine-design.md`), production guide (`TIME_MACHINE.md`).

### Data flow at a glance
1. **Mint** — orchestrator persists artefacts to `mint_jobs` row by row; image bytes and prompt text are held in Postgres until the user pays the fee, at which point they're pinned to Irys. This means abandoned previews cost nothing on-chain and nothing on Irys.
2. **Chat** — `/chat/<slug>` opens a WebSocket with the slug as a query param. The server loads the character row, instantiates a fresh Mastra agent with the cached system prompt, and gates the conversation on a sign-message + ownership/holding check.
3. **Moderation** — admins authenticated by `ADMIN_WALLETS` env var hit `/api/admin/regenerate-prompt` or `/api/admin/regenerate-portrait`. Update authority on the asset stays with the server keypair so this works without owner consent.

---

## Roadmap signals

- **In-app token buy.** Today the chat-side "Buy" links to the Genesis trading UI. Roadmap: in-page swap via `swapBondingCurveV2` so users never leave.
- **Admin/owner UIs.** API endpoints exist; web pages are next.
- **Voice mode.** TTS in the character's era-appropriate voice.
- **Group chat.** Two figures arguing with each other.

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
