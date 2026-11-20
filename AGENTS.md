# sure2p

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

P2P trade-assurance escrow on Arc Testnet for digital goods. Buyer escrows 100% of the price plus a 25% deposit, Seller escrows a separate 25% deposit; delivery happens outside the app; release needs both confirmations or a dual-signed mutual settlement. Locked deals exit through a dual-signed mutual settlement or an Arbiter ruling with one 72 hour appeal and per-party deposit penalties and fraud flags (escrow V3), with evidence upload and an admin console at `/admin`. Notifications and the AI Copilot are deferred (see `docs/DECISIONS.md`).

## Deployed contracts (Arc Testnet)

- Sure2PEscrowV3 (current, used by the app): `0xab91b5239f65d9f125d0a1d5d93350f257dba33c` (tx `0xffb3b587a9249b2110015072273202e57254a7102902794147c96a7dedf6141e`). Owner and penalty wallet `0xEb8d...7253e`, arbiter `0x3026...FEB6`, appeal reviewer `0x835E...A88E`. Penalty wallet is immutable.
- Sure2PEscrowV2 (retired from the app, no escrows, no funds): `0xbac54f5f54516007b5db955ee45433920893d94a` (tx `0x3da72eb58a398e576a02a4f8d6635998ee346c59b6c30ece9d15f49eaddccb08`)
- Sure2PEscrow (V1, retired from the app, still on chain with 3 test escrows): `0xcdaf4bc89d9e44eac1c36d9ee01724e5e51d90b9` (tx `0x422002da4274996918369fd3758a929b0ff98607cadab927453fd78e6261bf11`)
- Sure2PAccountRegistry: `0xfa6a19d4597a55f1f64003fb28fba199f8bafacd` (tx `0xf367e3c8a152940ac66fd1dd4dd309e7bba6cc08b026fd49e75187f129f23399`)
- Registry roles currently belong to the Arc Studio platform deployer wallet; hand them to an operator wallet before real use.
- Redeploying the escrow changes its address; update the `VITE_` keys in `.env` and restart both the web app and the API.

## Layout

- `contracts/` Solidity and Foundry tests. `src/shared/` is the protocol code shared by the web app and API (agreement hashing, EIP-712 types, generated ABIs).
- `server/` API with a SQLite-compatible database (`server/data` file for local dev, Turso libSQL on Vercel), auth, drafts, invitations, transactions, settlements, and `server/indexer/`. On Vercel the same handlers run as Serverless Functions under `api/`.
- Phone OTP is a labeled mock. Writes in `scripts/e2e-smoke.ts` use the public RPC because the sandbox RPC proxy refuses raw transactions.
- Docs live in `docs/`.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Routes (landing, sign-in, transactions, new, join, detail)
- `src/components/` - UI components (DraftPanel for negotiation and signing, EscrowPanel for the live deal)
- `src/config.ts` - wagmi config (chains, connectors, transports)
- `scripts/e2e-smoke.ts` - live Arc Testnet end-to-end run (`init`, then `run`)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev        # API on :8787 plus Vite on :5173 (/api is proxied)
bun run check      # lint and typecheck
bun run test       # Vitest
bun run contracts:test
```
