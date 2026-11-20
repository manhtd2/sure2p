# Deploying sure2p to Vercel

Arc Testnet only (chain ID 5042002). This guide deploys the existing React + Vite
app as a static site plus Vercel Serverless Functions for `/api`. **No Next.js,
no new account or payment is needed for the code itself** — but you do need a
free Turso account and a Vercel account (both free tiers work).

## What changed for Vercel (and why)

| Blocker | Fix |
|---|---|
| API used `bun:sqlite` on disk; Vercel has no persistent filesystem | **Turso libSQL** — same SQLite schema, same SQL, persistent. Local dev still uses the SQLite file when no Turso URL is set. |
| Continuous background indexer loop; Vercel has no background process | Indexing is now a **bounded sync pass** (max 10 chunks per pass) triggered lazily by API reads (debounced ≥ 15s, never blocking a request for more than 8s) plus a **Vercel Cron** endpoint every 5 minutes. Durable cursor, idempotency and reorg handling are unchanged. |
| `/api` only existed via the Vite dev proxy | `api/[...path].ts` reuses the existing `server/http.ts` handler — no business route was rewritten. |
| No build script / no `vercel.json`; SPA routes 404 on reload | `package.json` has `"build": "vite build"`; `vercel.json` rewrites all non-`/api` routes to `/index.html`. |
| Contract addresses not declared | `VITE_SURE2P_ESCROW_ADDRESS` and `VITE_ACCOUNT_REGISTRY_ADDRESS` are set as Vercel env vars (see below). |
| Mock OTP refused in production | Default still refuses. A demo deploy can opt in with `DEMO_ALLOW_MOCK_OTP=true` — demo only, see the warning below. |

### Why Turso libSQL (and not Vercel Postgres / Neon)

The schema and all queries are SQLite (`?` placeholders, `INSERT OR IGNORE`,
`GLOB`, `AUTOINCREMENT`). Turso is SQLite over HTTP, so the same tables and
business logic work unchanged — the only change is the driver (sync
`bun:sqlite` calls became async `dbGet`/`dbAll`/`dbRun`/`dbTx` in
`server/db.ts`). Vercel Postgres / Neon would have required a dialect rewrite
of every query and the migration, for no benefit at this scale. Trade-offs of
Turso: it is a separate vendor/account from Vercel; the free tier is generous
for a demo but has storage/row limits; HTTP round-trips are slower than a
local file, so the indexer and reads are bounded and debounced. If the app
later needs Postgres features (JSONB, full-text search, row-level security),
that migration is a deliberate rewrite, not a config change.

### What did NOT change

- Local dev is unchanged: `bun run dev` (API on :8787, Vite on :5173, `/api` proxied).
- The auth flow is unchanged (phone + OTP, then wallet + EIP-4361 signature).
- Routes, data and the transaction detail page are unchanged.
- No secret, private key or seed phrase is in this repo. Never commit `.env`.

## Step 1 — Create the Turso database

1. Sign up at [turso.tech](https://turso.tech) (free tier) and install the CLI, or use the dashboard.
2. Create a database, e.g. `sure2p`:
   ```bash
   turso db create sure2p
   turso db show sure2p --url            # → libsql://sure2p-<id>.turso.io
   turso db tokens create sure2p         # → auth token
   ```
   The schema is created automatically on first API use (idempotent, same
   tables as the local SQLite file).

## Step 2 — Set the Vercel environment variables

In the Vercel dashboard, Project → Settings → Environment Variables, set all of
these for **Production** (and Preview if you want preview deploys to work).
Generate the two secrets with `openssl rand -hex 32` — never reuse the local
dev values and never paste a real secret into chat or docs.

| Variable | Value | Notes |
|---|---|---|
| `VITE_SURE2P_ESCROW_ADDRESS` | `0xab91b5239f65d9f125d0a1d5d93350f257dba33c` | Deployed escrow V3 (Arc Testnet) |
| `VITE_ACCOUNT_REGISTRY_ADDRESS` | `0xfa6a19d4597a55f1f64003fb28fba199f8bafacd` | Deployed registry (Arc Testnet) |
| `VITE_SURE2P_ESCROW_DEPLOY_TX` | `0xffb3b587a9249b2110015072273202e57254a7102902794147c96a7dedf6141e` | Where the indexer starts scanning (escrow V3 deployment) |
| `SESSION_SECRET` | 64 hex chars, generated | Required in production |
| `PHONE_ENCRYPTION_KEY` | 64 hex chars, generated | Required in production |
| `TURSO_DATABASE_URL` | `libsql://sure2p-<id>.turso.io` | From Step 1 |
| `TURSO_AUTH_TOKEN` | token from Step 1 | From Step 1 |
| `DEMO_ALLOW_MOCK_OTP` | `true` | **Demo only** — see warning below |
| `CRON_SECRET` | a long random string, generated | Bearer token for the indexer cron |
| `RPC_URL_Arc_Testnet` | (optional) your own Arc RPC URL | Without it the public RPC is used and may rate-limit. Set 2026-11-16 to the QuickNode testnet gateway (`https://rpc.quicknode.testnet.arc.io`, no key needed, listed on docs.arc.io) after the public endpoint kept failing the indexer from Vercel. If it rate-limits too, use a dedicated endpoint with a key (e.g. Alchemy free tier) instead. |
| `APP_ORIGIN` | (optional) your domain, e.g. `https://sure2p.vercel.app` | Extra allowed browser origin |

### ⚠️ Demo mock OTP warning

`DEMO_ALLOW_MOCK_OTP=true` keeps the mock OTP working on the demo deploy, but
**the code is returned by the API** (`POST /api/auth/otp/request` responds with
`mockCode`), so anyone who can guess a phone number can sign in as that number.
Use it only for a demo with test accounts. For any real users, remove the flag
(default: the server refuses to start with mock OTP in production) and plug in
a real SMS provider.

Notes for the ruling release: evidence files (up to 2 MB, sent as base64) are stored in the Turso database, so no extra storage service is needed and the request stays under Vercel's 4.5 MB body limit. The admin console at `/admin` needs no extra setting: access follows the arbiter and appeal reviewer wallets stored in the contract.

## Step 3 — Import to Vercel and deploy

1. Push this project to a Git repo (GitHub / GitLab / Bitbucket), or use
   `vercel` CLI with `vercel import`.
2. In Vercel: Add New → Project → import the repo.
3. Framework preset: **Vite**. Build command `npm run build`, output directory
   `dist` — these are already set in `vercel.json`; confirm Vercel detected
   them and do not change them.
4. Set the env vars from Step 2, then Deploy.

**Cron limitation (Hobby plan):** `vercel.json` now schedules the indexer cron once daily (`0 0 * * *`) because the **Vercel Hobby plan only allows daily crons** — the original 5-minute schedule (`*/5 * * * *`) was rejected at deploy time on 2026-11-16 with "Hobby accounts are limited to daily cron jobs". The app still works, because API reads also trigger a bounded lazy sync pass, so the index catches up whenever anyone uses the app. For a 5-minute cron you need the **Pro** plan (restore `*/5 * * * *` in `vercel.json`). Either way, set `CRON_SECRET` so the endpoint is not open.

## Step 4 — Smoke-test the deployment

Run these against your deployed URL (replace `https://<your-app>.vercel.app`):

```bash
BASE=https://<your-app>.vercel.app

# 1. Health — should return ok:true and indexer state
curl $BASE/api/health

# 2. SPA fallback — reloading a deep route must serve the app, not a 404
curl -s $BASE/transactions/anything | grep -o '<div id="root">'   # → <div id="root">
curl -s $BASE/signin | grep -o '<div id="root">'

# 3. Sign-in page — cosmic perfect-transaction animation, then the login card
#    Open $BASE/signin in a browser: the animation plays one full loop,
#    holds 5 seconds, then repeats. Press "Đăng nhập" and the login card
#    takes over prominently (animation dims behind it).

# 4. Mock OTP login (demo only) — request a code, verify it, check the session
curl -s -X POST $BASE/api/auth/otp/request \
  -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"phone":"+84901234567"}'
# → {"sent":true,"provider":"mock","mockCode":"123456",...}
curl -s -X POST $BASE/api/auth/otp/verify \
  -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"phone":"+84901234567","code":"123456"}' -c /tmp/cookies.txt
curl -s $BASE/api/me -b /tmp/cookies.txt   # → {"authenticated":true,...}
curl -s $BASE/api/transactions -b /tmp/cookies.txt  # → {"items":[...]}

# 5. Cron endpoint — without the token it must be 401
curl -s $BASE/api/cron/indexer            # → {"error":"unauthorized"}
curl -s $BASE/api/cron/indexer -H "Authorization: Bearer <CRON_SECRET>"
# → {"ok":true,...} (runs one bounded indexer pass)
```

After login, `/transactions` is the main page (no dashboard): filter by role
(Buyer / Seller) and by status, and each card shows the deadline and the next
step prominently.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `500` on `/api/*`, logs mention the database | `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` wrong or missing. Check Vercel env vars and redeploy (env changes need a redeploy). |
| Nested `/api/*` (e.g. `/api/auth/otp/request`) returns Vercel's plain-text `NOT_FOUND` while `/api/health` works | Catch-all `api/[...path].ts` is a Next.js-only feature: on a Vite static deploy it only matches single-segment paths. Fix (2026-11-16): the shared handler lives in `server/vercelHandler.ts` and every nested route has its own thin file under `api/` (`api/auth/[group]/[action].ts`, `api/transactions/[publicId]/[action].ts`, ...). If you add a new nested API route, add its file too — do not rely on the catch-all. |
| Deploy fails with `exceeded_serverless_functions_per_deployment` | The Vercel **Hobby plan allows at most 12 Serverless Functions per deployment**. The fix above briefly created 14 and the deploy errored. Fix (2026-11-16): consolidated routes into dynamic files (`api/auth/[group]/[action].ts`, `api/auth/[group].ts`, `api/invitations/[id].ts`) so the total is exactly 12; the 6 superseded files are listed in `.vercelignore` so they are not deployed. If you add another API route, consolidate it into an existing dynamic file instead of adding a 13th function — or the deploy will fail again. |
| Deploy fails with `conflicting_file_path` | Two dynamic files in the same `api/` directory used different segment names (e.g. `api/invitations/[action].ts` vs `api/invitations/[id]/revoke.ts`). Vercel requires dynamic segments in the same directory to share a name. Fix (2026-11-16): the consolidated files are named `[group]` under `api/auth/` and `[id]` under `api/invitations/` to match their sibling directories. |
| `/api/auth/otp/request` (or any nested route) returns `500 FUNCTION_INVOCATION_FAILED` with `SyntaxError: Unexpected token '*'` in the runtime logs | A `*/` sequence inside a block comment in an `api/` file closes the comment early; the TypeScript 7 transpiler then emits a broken file that Node cannot parse (and the function's bundle ends up missing its dependencies). Fix (2026-11-16): the comment in `api/auth/[group]/[action].ts` said `/api/auth/*/*` — rewritten to avoid `*/`. Rule: never write `*/` inside a block comment in `api/` (or anywhere a comment describes a path with a wildcard). |
| `vite: command not found` during build | Do **not** set `NODE_ENV=production` as a project env var: Vercel already sets it for production deployments, and a user-set value makes `npm install` skip devDependencies (vite is a devDependency). Fixed 2026-11-16 by removing the variable; the server still sees `NODE_ENV=production` at runtime. |
| Server refuses to start, "mock OTP" error | `NODE_ENV=production` without a real provider: either set `DEMO_ALLOW_MOCK_OTP=true` (demo only) or add a real SMS provider. |
| `/health` shows `lastError` from the indexer | The public RPC is rate-limiting or unreachable. Set `RPC_URL_Arc_Testnet` to your own RPC. The API still serves the last indexed state. If the error is `RPC Request failed` right after a fresh deploy, the cause was the `eth_getLogs` filter: the indexer queried all 15 escrow events in one call, which the Arc testnet RPCs reject with JSON-RPC -32012 "requested range too large" even over 10 blocks (and 2000-block ranges fail even unfiltered). Fixed 2026-11-16: `indexRange` in `server/indexer/index.ts` queries the events in groups of 5 (subset ABI per group) over 10000-block chunks — 5 topics work over 10000 blocks, 3 topics fail over 50000. If the error instead says `Request exceeds defined limit`, the public QuickNode gateway is rate-limiting the burst of calls; the sequential 5-topic groups keep each pass to ~3 calls per chunk. |
| `/transactions/...` 404 on reload | `vercel.json` SPA rewrite missing — confirm the file is in the repo root and the deployment picked it up. |
| Indexer lags (old deals missing) | Hobby cron is daily; open the app (lazy sync runs on reads) or upgrade to Pro for the 5-minute cron. Check `GET /health` → `indexer.blocksBehind`. |
| `tsc` error in `scripts/compass-deploy.ts` | Pre-existing, unrelated to Vercel: `@circlefin/compass-chains` is not installed. That script is not used by the build or the deploy. |

## Local verification (what was checked before this guide)

- `bun run typecheck`: only the pre-existing `compass-deploy.ts` error above.
- `bun run test`: 19/19 pass.
- `bun run build` (`vite build`): passes.
- Serverless handler exercised under plain Node (Vercel-like) with a local
  libSQL file DB: `/api/health` 200, `/api/me` 200, unauthenticated
  `/api/transactions` 401, full mock-OTP login (request → verify → session
  cookie → authenticated `/me`, `/transactions` 200), cron endpoint 401
  without/wrong token.
- **Not verified here:** a live remote Turso database and the live Arc RPC
  (the sandbox blocks/slows it, so indexer syncs fail gracefully there and
  the API still serves the last indexed state). A live Vercel deployment
  itself is verified since 2026-11-16 (deploy 7 from GitHub main, API
  smoke-test `/api/health` 200, `/api/me` 200, cron 401 without token,
  `/api/transactions` 401 unauthenticated). Run Step 4 against the real
  deploy to confirm the Turso-backed login flow.

## Deploy từ GitHub (từ 2026-11-16)

- Repo: `manhtd2/sure2p` (Public), nhánh `main` đã nối với project Vercel
  `sure2p` (Settings → Git → Connected Git Repository). Push lên `main`
  sẽ tự trigger production deploy; không cần deploy bằng CLI nữa.
- Deploy bằng CLI (`vercel deploy --prod`) vẫn hoạt động nhưng chỉ dùng
  khi cần deploy gấp ngoài luồng Git.
