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

### Railway deployment

The repo's `railway.json` is preconfigured for Time Machine. You'll create
**three** Railway resources:

1. **Postgres add-on** — provides `DATABASE_URL`.
2. **Server service** — Node app from `Dockerfile` (this repo).
3. **UI service or Vercel project** — Next.js app from `packages/ui` (separate; the server image deliberately excludes the UI build).

#### Step 1 — Create the project + Postgres

From the dashboard:
- **New Project → Deploy from GitHub repo → pick your fork.** Railway auto-detects `railway.json`.
- In the same project, **+ New → Database → PostgreSQL.** Railway injects `DATABASE_URL` into your service automatically once they're in the same project.

#### Step 2 — Set the environment variables

Pin these on the **server** service. Railway's **Variables → Raw editor** accepts the dotenv block below — paste, then fill in the secrets.

```dotenv
# From the template
AGENT_MODE=public
AGENT_KEYPAIR=<base58 secret key OR JSON byte array>
WEB_CHANNEL_TOKEN=<openssl rand -hex 24>
WEB_CHANNEL_PORT=3002
ANTHROPIC_API_KEY=sk-ant-...
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
WS_ALLOWED_ORIGINS=https://your-ui-domain.com

# Time Machine
DATABASE_URL=${{Postgres.DATABASE_URL}}        # Railway-style reference; see note
OPENAI_IMAGE_API_KEY=sk-...
ADMIN_WALLETS=DhYCi6pvfhJkPRpt5RjYwsE1hZw84iu6twbRt9B6dYLV
MINT_FEE_LAMPORTS=250000000
PUBLIC_BASE_URL=https://your-ui-domain.com
IP_HASH_SALT=<openssl rand -hex 16>

# Filled in after the bootstrap steps below
COLLECTION_ADDRESS=
MINT_FEE_RECIPIENT=                            # leave blank to default to agent PDA
```

`${{Postgres.DATABASE_URL}}` is Railway's reference syntax — it resolves
the Postgres add-on's connection string automatically. If you didn't add
the add-on, set `DATABASE_URL` directly to your hosted Postgres URL.

#### Step 3 — First deploy

Push to your default branch (or click **Deploy** in the dashboard). The
`preDeployCommand: pnpm db:migrate` line in `railway.json` runs the schema
migration before the server starts — idempotent, so it's safe on every
deploy.

#### Step 4 — Generate a public domain

In **Server service → Settings → Networking → Public Networking**, click
**Generate Domain** with target port **3002**. Railway hands you a
`*.up.railway.app` URL. The WebSocket endpoint is `wss://<that-url>`.

#### Step 5 — Deploy the UI

Create a separate Vercel/Railway project for `packages/ui` with these env vars:

```dotenv
NEXT_PUBLIC_WS_HOST=<your server's railway.app host>
NEXT_PUBLIC_WS_PORT=443
NEXT_PUBLIC_WS_PROTOCOL=wss
NEXT_PUBLIC_WS_TOKEN=<same WEB_CHANNEL_TOKEN as server>
NEXT_PUBLIC_SOLANA_RPC_URL=<same SOLANA_RPC_URL>
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
```

Once the UI is live, **edit `packages/ui/public/collection/metadata.json`**
and replace the `timemachine.metaplex.com` placeholders with your actual
deployed domain, then push. The on-chain collection's URI points at
`${PUBLIC_BASE_URL}/collection/metadata.json` and the JSON in turn
references the SVG image — both must resolve from the same host.

#### Step 6 — Bootstrap on prod

Once both services are up:

1. **Create the Core collection** — run from your local machine, but
   pointing at the prod RPC and using a wallet you control:
   ```bash
   SOLANA_RPC_URL=<prod rpc> AGENT_KEYPAIR=<prod keypair> \
     PUBLIC_BASE_URL=https://your-ui-domain.com \
     pnpm tsx scripts/create-collection.ts
   ```
   Set the printed `COLLECTION_ADDRESS=...` on the Railway server service
   and redeploy.

2. **Seed starter characters** (optional):
   ```bash
   SERVER_URL=https://<your-server-railway-host> \
     SOLANA_RPC_URL=<prod rpc> \
     AGENT_KEYPAIR=<prod keypair> \
     pnpm tsx scripts/seed-characters.ts
   ```

That's it. `pnpm db:migrate` runs every deploy automatically, so schema
changes ship with code; everything else lives in env vars or static
files.

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
