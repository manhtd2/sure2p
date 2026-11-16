/**
 * Vercel Serverless Function entry point for the whole API.
 *
 * The Vite dev proxy strips `/api` before forwarding to the local Bun
 * server; this function does the same strip, then hands the request to the
 * existing route handlers in server/http.ts — no business route is
 * reimplemented here. vercel.json rewrites /api/* to this function.
 *
 * Runs under Node (Vercel), not Bun: the DB layer loads Turso libSQL when
 * TURSO_DATABASE_URL is set and never imports `bun:sqlite` on this path.
 */
import '../server/auth/routes.js'
import '../server/routes/drafts.js'
import '../server/routes/invitations.js'
import '../server/routes/transactions.js'
import '../server/routes/settlements.js'
import { handle } from '../server/http.js'

export const config = {
  // The indexer pass can take a few seconds on a cold start.
  maxDuration: 60,
}

async function handler(req: Request): Promise<Response> {
  // On Vercel req.url is a relative path (e.g. "/api/me?...path=me"), not an
  // absolute URL as under the local Bun server, so `new URL(req.url)` throws
  // ERR_INVALID_URL. A dummy base is enough: only pathname/search are used.
  const url = new URL(req.url, 'http://localhost')
  // Strip the /api prefix the same way the Vite dev proxy does, so the
  // existing routes (registered as /auth/..., /health, ...) match.
  const stripped = new URL(req.url, 'http://localhost')
  stripped.pathname = url.pathname.replace(/^\/api/, '') || '/'
  stripped.search = url.search
  // Rebuild the request explicitly: passing the incoming Request object as
  // RequestInit copies its body, which throws for GET/HEAD requests.
  const init: RequestInit = { method: req.method, headers: req.headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer()
  }
  const forwarded = new Request(stripped.toString(), init)
  return handle(forwarded)
}

// Vercel treats a default export as the Node-style `(req, res)` handler,
// which passes a Node request (plain-object headers, no Request API) and
// ignores a returned Response — so the API hung until the 60s timeout.
// Named HTTP-method exports get real Web Request/Response objects.
export const GET = handler
export const POST = handler
