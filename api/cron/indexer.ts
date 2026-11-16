/**
 * Vercel Cron endpoint: GET /api/cron/indexer
 *
 * Runs one bounded indexer pass (up to INDEXER_SYNC_MAX_CHUNKS 2000-block
 * ranges, default 10) plus a balance reconciliation, under the same durable
 * lock as lazy request-triggered sync, so cron and API reads never duplicate
 * work. See vercel.json for the schedule.
 *
 * Auth: if CRON_SECRET is set, the caller must send
 * `Authorization: Bearer <CRON_SECRET>`. Vercel Cron sends that header when
 * the secret is configured as the cron secret. Without CRON_SECRET the
 * endpoint is unauthenticated but harmless — it only advances the public
 * escrow index — so set CRON_SECRET anyway to avoid strangers burning your
 * RPC quota.
 */
import { env } from '../../server/env.js'
import { indexerStatus, reconcile, runIndexerOnce } from '../../server/indexer/index.js'

export const config = {
  maxDuration: 60,
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (env.cronSecret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${env.cronSecret}`) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
  try {
    const ran = await runIndexerOnce()
    await reconcile().catch((err) => console.error('[cron] reconcile failed:', err instanceof Error ? err.message : err))
    const s = indexerStatus()
    return new Response(
      JSON.stringify({ ok: true, ran, cursor: s.cursor, head: s.head, behind: s.behind, lastError: s.lastError }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'indexer error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// Vercel treats a default export as the Node-style `(req, res)` handler,
// which passes a Node request (plain-object headers) and ignores a returned
// Response. Named HTTP-method exports get real Web Request/Response objects.
export const GET = handler
export const POST = handler
