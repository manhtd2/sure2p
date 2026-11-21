# sure2p

sure2p is a peer-to-peer trade-assurance app for digital goods on Arc Testnet. A buyer and a seller agree on terms, lock the price and two security deposits in an escrow, exchange the goods outside the app, and release the money only when both sides confirm. Testnet only.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- Sign in with a phone number and a wallet signature. In this build the phone code is a clearly labeled mock for development and testnet.
- Create a deal as buyer or seller, then invite the other side with a link, a short code or a QR code. The other side can accept or counter, and both sign the same final version.
- Account page (masked phone, status, linked wallet, language, sign out).
- Public pages without sign-in: how it works, Trust (live onchain figures), Status (live probes), docs (22 articles), FAQ, policies, fees, changelog and a contact form. Legal text that still needs decisions is shown as clearly labelled gaps.
- The Buyer can attach description files for the goods (Excel, Word, PDF, TXT, CSV or images, up to 5 files of 3 MB). After both sides sign, the files are locked, and once the escrow is created they stay as evidence the parties and the Arbiter can compare against the goods in a dispute.
- Delete a draft you created if nobody has joined it yet (for example an invitation made by mistake).
- Fund the escrow: the buyer locks 100% of the price plus a 25% deposit, the seller locks a separate 25% deposit. The deal starts only when both are fully funded.
- See a time-progress bar for the deal. It is informational only and does not move money.
- Confirm handover and receipt, then claim your funds to your own wallet. The seller receives the full price even when the deal finishes early, and both deposits are returned.
- If a deal goes overdue or is disputed, funds are locked. The way out is a mutual settlement that both sides sign, or a ruling by an Arbiter who splits the price and can penalize the at-fault side by up to 100% of its own deposit. Either side can appeal once within 72 hours to a different reviewer.
- Upload evidence (images, PDF, text, CSV, Excel, Word) for an open case. Files are encrypted, checked on upload for macros, scripts and similar tricks (a basic check, not antivirus), and downloaded through links that expire after 300 seconds. Only the two sides and the Arbiter and Appeal Reviewer can open them, and you can anchor a file's hash onchain.
- A notification bell and inbox: deadline reminders, what the other side did, disputes, rulings and claims waiting. They are worked out from live onchain state; nothing is sent by email or SMS.
- A floating assistant chat you can drag anywhere on screen. It lists what you need to do at each step of your deals, answers questions from the docs and FAQ and about your own amounts and deadlines, and opens previews that expire after 300 seconds. It never signs, sends or rules. Free-form model answers (12 tools) turn on only when you set `AI_API_KEY`.
- Arbiter and Appeal Reviewer use the admin console at `/admin`. It appears only for the wallet that holds the role onchain.
- The penalty wallet signs in the same way and opens `/admin` to claim the penalties paid to it, one deal at a time.
- Switch the interface between Vietnamese and English.

Not included yet: email or SMS notifications, a real SMS provider for the phone code, an external object store and antivirus for evidence, and independent review of the English translations (the Vietnamese text controls).

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi and viem for the app. A small API (Bun locally, Vercel Serverless Functions in production) with a Turso libSQL database — the same SQLite schema — and a chain indexer for drafts, invitations and history. Solidity with Foundry and OpenZeppelin for the contracts.

## Development

Prerequisites: Bun and Foundry.

```bash
bun install
cp .env.example .env   # then fill in the deployed contract addresses
bun run dev            # starts the API and the web app
```

Environment variables (names only, see `.env.example`):

- `VITE_SURE2P_ESCROW_ADDRESS`, `VITE_ACCOUNT_REGISTRY_ADDRESS`: deployed contract addresses.
- `VITE_SURE2P_ESCROW_DEPLOY_TX`: deployment transaction, where the indexer starts.
- `API_PORT`, `DATABASE_PATH`, `NODE_ENV`: API server settings. `DATABASE_PATH` is local dev only.
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`: persistent database (Vercel). Leave unset locally to use the SQLite file.
- `OTP_PROVIDER`: only `mock` exists, and it is refused in production unless `DEMO_ALLOW_MOCK_OTP=true` (demo only — the code is returned by the API).
- `SESSION_SECRET`, `PHONE_ENCRYPTION_KEY`: required in production, generated locally otherwise.
- `EVIDENCE_ENCRYPTION_KEY`: optional, 32 bytes of hex for encrypting evidence files. When unset it is derived from `PHONE_ENCRYPTION_KEY`.
- `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`: optional. Enable assistant chat against any OpenAI-compatible endpoint. Without a key chat is off and the tools still work.
- `CRON_SECRET`: bearer token for the Vercel Cron indexer endpoint.
- `INDEXER_LAZY_MIN_INTERVAL_MS`, `INDEXER_LAZY_TIMEOUT_MS`: serverless indexer tuning.
- `APP_ORIGIN`: extra allowed browser origins.
- `INDEXER_CONFIRMATIONS`: blocks to wait before treating a block as final.
- `RPC_URL_Arc_Testnet`: optional RPC override.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provisioned by Arc Studio; optional elsewhere.

## Deploying to Vercel

See [`DEPLOY_VERCEL.md`](DEPLOY_VERCEL.md) for the exact step-by-step: create a Turso database, set the environment variables, import the repo to Vercel, deploy, and smoke-test. Local dev is unchanged (`bun run dev`).

## Interface notes

- Sign-in (`/signin`) opens with the cosmic perfect-transaction animation — one full loop, a 5-second hold, then repeat. When you start logging in, the animation dims behind a prominent glass login card. The auth flow itself is unchanged (phone + OTP, then wallet + EIP-4361 signature).
- After login, the transaction list (`/transactions`) is the main page — no dashboard. It filters by role (Buyer / Seller) and by status, and each card shows the deadline and the next step prominently.

Commands:

```bash
bun run check           # lint and typecheck
bun run test            # app and API unit tests
bun run contracts:test  # Foundry contract tests
bun run contracts:build # compile contracts
```

More detail lives in `docs/`.
