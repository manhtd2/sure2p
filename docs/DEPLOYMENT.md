# Deployment

Arc Testnet only (chain ID 5042002). Verify network and token details against the official Arc documentation before every deployment.

## Contracts

1. `bun run contracts:build` then `bun run contracts:test`.
2. Deploy `Sure2PAccountRegistry(admin, security)`, then `Sure2PEscrow(usdc, registry)` with the Arc Testnet USDC address from `src/onchain-facts.ts`.
3. Put the addresses and the escrow deployment transaction in `.env` (`VITE_SURE2P_ESCROW_ADDRESS`, `VITE_ACCOUNT_REGISTRY_ADDRESS`, `VITE_SURE2P_ESCROW_DEPLOY_TX`).
4. Move the registry admin and security roles to an operator wallet or multisig and revoke the deployer's. Never use a shared platform wallet as the long-term owner.

Escrow addresses differ between contract versions. Existing escrows live on the version that created them.

## App and API

- `bun run dev` starts the API (port 8787) and the web app. The web app proxies `/api` to the API.
- Production needs `SESSION_SECRET`, `PHONE_ENCRYPTION_KEY` and a real phone provider. The mock provider exits on startup when `NODE_ENV=production`, unless the demo opt-in `DEMO_ALLOW_MOCK_OTP=true` is set — demo only, because the mock code is returned by the API and anyone who can guess a phone number can sign in.
- **Vercel:** see [`DEPLOY_VERCEL.md`](../DEPLOY_VERCEL.md). The database is Turso libSQL (same SQLite schema, persistent), the API runs as Vercel Serverless Functions under `api/` reusing the same route handlers, and the indexer runs as a bounded lazy sync on API reads plus a Vercel Cron endpoint. The local SQLite file under `server/data` is local dev only and is never the primary store on Vercel.
- SQLite lives under `server/data` (local dev only). Back it up and keep it on durable storage. The indexer rebuilds all escrow state by replaying events, so losing it loses drafts, invitations and sign-in links but not funds.
- Indexer recovery: delete the escrow and event tables' cursor state, or the database file, and restart. It resumes from the deployment block.
- A deployed API needs its own RPC URL per chain in `RPC_URL_Arc_Testnet`; without it the public RPC is used and may rate-limit.

## Operations to watch

Indexer lag (`GET /health`), the reconciliation flag (contract USDC balance versus outstanding liabilities), overdue and disputed deals, unclaimed credits, and registry role changes.
