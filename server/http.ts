/** Minimal router, session handling, CSRF/origin checks and rate limiting. */
import { z, type ZodType } from 'zod'
import { dbGet, dbRun, nowSec } from './db.js'
import { env } from './env.js'
import { hmac, randomToken } from './lib/crypto.js'
import { maybeSyncIndexer } from './indexer/index.js'

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public headers?: Record<string, string>,
  ) {
    super(message ?? code)
  }
}

/** Uniform response for both "missing" and "not allowed" so ids cannot be enumerated. */
export const notFound = () => new HttpError(404, 'not_found', 'Not found')

export interface Session {
  sidHash: string
  accountId: string
  wallet: string | null
  chainId: number | null
  accountStatus: 'active' | 'banned' | 'limited'
}

export interface Ctx {
  req: Request
  url: URL
  params: Record<string, string>
  session: Session | null
  body<T>(schema: ZodType<T>): Promise<T>
  ip: string
  setCookies: string[]
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown
interface Route {
  method: string
  regex: RegExp
  keys: string[]
  handler: Handler
}

const routes: Route[] = []

export function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = []
  const pattern = path.replace(/:([a-zA-Z]+)/g, (_m, k: string) => {
    keys.push(k)
    return '([^/]+)'
  })
  routes.push({ method, regex: new RegExp(`^${pattern}$`), keys, handler })
}

const SESSION_COOKIE = 's2p_sid'
const SESSION_TTL = 12 * 60 * 60
const MAX_BODY_BYTES = 64 * 1024

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const idx = part.indexOf('=')
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

export async function loadSession(req: Request): Promise<Session | null> {
  const sid = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE]
  if (!sid) return null
  const sidHash = hmac('session', sid)
  const row = await dbGet<{
    id_hash: string
    account_id: string
    wallet: string | null
    chain_id: number | null
    expires_at: number
    status: Session['accountStatus']
  }>(
    `SELECT s.id_hash, s.account_id, s.wallet, s.chain_id, s.expires_at, a.status
     FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.id_hash = ?`,
    sidHash,
  )
  if (!row || row.expires_at < nowSec()) return null
  return {
    sidHash,
    accountId: row.account_id,
    wallet: row.wallet,
    chainId: row.chain_id,
    accountStatus: row.status,
  }
}

export async function createSession(ctx: Ctx, accountId: string): Promise<void> {
  const sid = randomToken(32)
  const now = nowSec()
  await dbRun(
    'INSERT INTO sessions (id_hash, account_id, wallet, chain_id, created_at, expires_at, user_agent) VALUES (?, ?, NULL, NULL, ?, ?, ?)',
    hmac('session', sid),
    accountId,
    now,
    now + SESSION_TTL,
    (ctx.req.headers.get('user-agent') ?? '').slice(0, 200),
  )
  const secure = ctx.url.protocol === 'https:' || ctx.req.headers.get('x-forwarded-proto') === 'https'
  ctx.setCookies.push(
    `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secure ? '; Secure' : ''}`,
  )
}

export async function destroySession(ctx: Ctx): Promise<void> {
  if (ctx.session) await dbRun('DELETE FROM sessions WHERE id_hash = ?', ctx.session.sidHash)
  ctx.setCookies.push(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export function requireSession(ctx: Ctx): Session {
  if (!ctx.session) throw new HttpError(401, 'unauthenticated', 'Sign in required')
  return ctx.session
}

/** Financial actions need a verified phone account AND a signed wallet on the expected chain. */
export function requireWallet(ctx: Ctx): Session & { wallet: string } {
  const s = requireSession(ctx)
  if (!s.wallet) throw new HttpError(403, 'wallet_required', 'Link a wallet to continue')
  if (s.chainId !== env.chainId) throw new HttpError(403, 'wrong_chain', 'Wallet proof is for a different chain')
  return s as Session & { wallet: string }
}

/** Banned accounts may read and claim, but may not start or join new trades. */
export function requireNewTradeEligible(s: Session): void {
  if (s.accountStatus !== 'active') throw new HttpError(403, 'account_restricted', 'This account cannot start or join new trades')
}

const buckets = new Map<string, { count: number; reset: number }>()

export function rateLimit(key: string, max: number, windowSec: number): void {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowSec * 1000 })
    return
  }
  b.count += 1
  if (b.count > max) {
    throw new HttpError(429, 'rate_limited', 'Too many requests', {
      'Retry-After': String(Math.max(1, Math.ceil((b.reset - now) / 1000))),
    })
  }
}

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k)
}, 60_000).unref()

function originAllowed(req: Request, url: URL): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return false
  }
  const reqHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host).split(':')[0]
  return (
    host === reqHost ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.preview.studio.arc.io') ||
    host === 'studio.arc.io' ||
    env.extraOrigins.some((o) => o === origin)
  )
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

function respond(data: unknown, status: number, cookies: string[], extra?: Record<string, string>): Response {
  const headers = new Headers({ ...BASE_HEADERS, ...extra })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), { status, headers })
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const cookies: string[] = []
  try {
    const match = routes.find((r) => r.method === req.method && r.regex.test(url.pathname))
    if (!match) throw notFound()

    if (req.method !== 'GET') {
      // The preview proxy drops custom x-* headers except X-Requested-With, so it carries the CSRF marker.
      if (req.headers.get('x-requested-with') !== 'XMLHttpRequest') throw new HttpError(403, 'csrf', 'Missing CSRF marker')
      if (!originAllowed(req, url)) throw new HttpError(403, 'origin', 'Origin not allowed')
    }

    // On Vercel there is no background indexer loop. Reads of indexed data
    // trigger a bounded, debounced sync pass first (no-op while the local
    // background loop is running, and never fatal if the chain is unreachable).
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname.startsWith('/transactions'))) {
      await maybeSyncIndexer().catch(() => undefined)
    }

    const m = match.regex.exec(url.pathname)!
    const params: Record<string, string> = {}
    match.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
    const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim()

    const ctx: Ctx = {
      req,
      url,
      params,
      ip,
      session: await loadSession(req),
      setCookies: cookies,
      async body<T>(schema: ZodType<T>): Promise<T> {
        const len = Number(req.headers.get('content-length') ?? 0)
        if (len > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Body too large')
        const text = await req.text()
        if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Body too large')
        let json: unknown
        try {
          json = text ? JSON.parse(text) : {}
        } catch {
          throw new HttpError(400, 'invalid_json', 'Invalid JSON')
        }
        const parsed = schema.safeParse(json)
        if (!parsed.success) {
          throw new HttpError(400, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
        }
        return parsed.data
      },
    }
    rateLimit(`ip:${ip}`, 600, 60)
    const result = await match.handler(ctx)
    return respond(result ?? { ok: true }, 200, cookies)
  } catch (err) {
    if (err instanceof HttpError) {
      return respond({ error: err.code, message: err.message }, err.status, cookies, err.headers)
    }
    console.error('[api] unhandled error', err instanceof Error ? err.message : err)
    return respond({ error: 'internal', message: 'Internal error' }, 500, cookies)
  }
}

export { z }
