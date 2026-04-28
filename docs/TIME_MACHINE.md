# Time Machine — Setup & Operations

This is the product-specific setup for Time Machine, layered on top of the underlying Metaplex Agent template. See `docs/plans/2026-04-27-time-machine-design.md` for the full design.

## Required environment variables (beyond template defaults)

See `.env.example` for the full list. The Time Machine block:

```dotenv
DATABASE_URL=postgresql://timemachine:timemachine@localhost:5433/timemachine
OPENAI_IMAGE_API_KEY=sk-...
ADMIN_WALLETS=DhYCi6pvfhJkPRpt5RjYwsE1hZw84iu6twbRt9B6dYLV
MINT_FEE_LAMPORTS=250000000
MINT_FEE_RECIPIENT=<wallet address>
COLLECTION_ADDRESS=<set after running scripts/create-collection.ts>
IP_HASH_SALT=<openssl rand -hex 16>
```

Irys uploads are paid by the existing `AGENT_KEYPAIR` via the
`umi-uploader-irys` plugin. The Irys network is inferred from
`SOLANA_RPC_URL` — devnet if the URL contains "devnet"/"testnet", mainnet
otherwise — so the agent wallet must be funded on whichever network you
point at.

## One-time bootstrap

### Local dev (OrbStack / Docker)

1. **Bring up Postgres** (auto-seeds schema on first boot):
   ```bash
   pnpm db:up
   ```
   Idempotent. The container is named `time-machine-postgres` and uses a
   named volume `timemachine_pgdata`. Run `pnpm db:reset` to nuke and
   re-seed; `pnpm db:down` to stop without deleting data.

2. **Create the Core collection** (once per deploy environment):
   ```bash
   pnpm tsx scripts/create-collection.ts
   ```
   Copy the printed `COLLECTION_ADDRESS=...` line into your `.env`.

   The on-chain collection asset's URI points at
   `${PUBLIC_BASE_URL}/collection/metadata.json` — a static JSON shipped in
   the UI at `packages/ui/public/collection/metadata.json`, alongside an
   SVG logo at `packages/ui/public/collection/image.svg`. If you're
   self-hosting on a custom domain, edit the `image`, `external_url`, and
   `properties.files[].uri` fields in that JSON so they reference your own
   host before running the script.

3. **Start the server** (also runs `pnpm db:up`):
   ```bash
   pnpm dev
   ```

4. **Seed starter characters** (optional but recommended so the explore page isn't empty):
   ```bash
   pnpm tsx scripts/seed-characters.ts
   ```
   Mints George Washington, Lincoln, Einstein, Newton, da Vinci, Cleopatra,
   Napoleon, Tesla, Marie Curie, and Sun Tzu under the founder wallet
   (your `AGENT_KEYPAIR`).

### Railway production

Railway provisions a Postgres instance and injects `DATABASE_URL` at
runtime. The schema does not auto-apply in prod (no init-script mount), so
run the migrate step on first deploy and after any schema change:

```bash
DATABASE_URL=<railway db url> pnpm db:migrate
```

`pnpm db:migrate` is idempotent (the schema uses `CREATE ... IF NOT
EXISTS`), so it's safe to run on every deploy. You can wire it into
`railway.json` as a release command.

## HTTP API surface

| Method | Path | Notes |
|---|---|---|
| POST | `/api/mint/canonicalize` | LLM canonicalize + fuzzy dedup. Body: `{ rawName, wallet }`. |
| POST | `/api/mint/preview` | Generate prompt + portrait + Irys pin. Body: `{ mintJobId, ticker }`. |
| POST | `/api/mint/finalize` | Server mints asset + registers identity, builds user txs. |
| POST | `/api/mint/confirm` | After user submits user txs, persists character row. |
| GET  | `/api/characters` | List active characters. |
| GET  | `/api/characters/:slug` | Single character lookup. |
| GET  | `/api/health` | Liveness probe. |
| POST | `/api/admin/regenerate-prompt` | Regenerate + re-pin a character's system prompt. Requires `x-admin-wallet` header. |
| POST | `/api/admin/regenerate-portrait` | Regenerate + re-pin a character's portrait. |
| POST | `/api/admin/set-status` | Set `active` / `flagged` / `disabled` / `regenerating`. |
| GET  | `/api/admin/tickets` | List open moderation tickets. |

The WebSocket continues to live on the same port. Connect with `?slug=<slug>` to load a per-character agent (anonymous chat). Plain WS connections without slug fall back to the default Mastra agent.

## UI routes

- `/explore` — character grid.
- `/mint` — mint wizard (wallet required).
- `/chat/[slug]` — per-character chat with token panel.

## Known gaps (v1.5)

- Buy-from-chat is currently a deep link to the Genesis trading UI. In-app `swapBondingCurveV2` requires bonding-curve PDA derivation; landed as a v1.5 polish item.
- Owner dashboard (`/my-characters`) has API support (`/api/characters?ownerWallet=...`) but no UI page yet.
- Admin UI (`/admin`) has API support but no UI page yet.
- Pre-seed script does not yet handle Genesis "first buy" amounts; relies on protocol defaults.
