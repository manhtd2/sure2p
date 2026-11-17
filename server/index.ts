/**
 * Local development entry point (Bun). `bun run dev` serves this on :8787
 * and starts the continuous indexer loop.
 *
 * On Vercel this file is NOT used: there is no Bun runtime and no
 * long-lived process. The API runs as Serverless Functions under `api/`
 * (see api/[...path].ts), which reuse the same route handlers, and indexing
 * runs on demand plus via the Vercel Cron endpoint (api/cron/indexer.ts).
 */
import { env } from './env.js'
import './db.js'
import { handle } from './http.js'
import './auth/routes.js'
import './routes/drafts.js'
import './routes/invitations.js'
import './routes/transactions.js'
import './routes/settlements.js'
import './routes/evidence.js'
import './routes/admin.js'
import { startIndexer } from './indexer/index.js'

if (typeof Bun === 'undefined') {
  throw new Error('server/index.ts is the local Bun entry point. On Vercel the API runs from api/[...path].ts.')
}

const server = Bun.serve({
  port: env.port,
  hostname: '0.0.0.0',
  fetch: handle,
})

startIndexer()

console.log(`[sure2p] API listening on :${server.port} (OTP provider: ${env.otpProvider.toUpperCase()}, MOCK, dev and testnet only)`)
console.log(`[sure2p] escrow ${env.escrow} on chain ${env.chainId}`)
