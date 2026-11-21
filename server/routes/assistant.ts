/**
 * Assistant surface. Prepared actions are previews that expire after 300 seconds, belong to one account and wallet, and
 * do nothing until the account confirms. A confirm re-checks the live state first; a wallet call still needs the
 * wallet's own signature in the browser.
 */
import { z } from 'zod'
import { dbGet, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import { callRoute, HttpError, notFound, rateLimit, requireWallet, route, type Ctx } from '../http.js'
import { randomToken } from '../lib/crypto.js'
import { chatEnabled, chatSchema, runChat } from '../assistant/chat.js'
import { PREVIEW_TTL_SECONDS, TOOLS, parseInput, toolByName, type Effect, type Preview } from '../assistant/tools.js'
import { saveNote } from './evidence.js'

interface StoredPreview {
  input: unknown
  preview: Preview
}

interface PreviewRow {
  id: string
  account_id: string
  wallet: string | null
  chain_id: number
  contract: string
  tool: string
  fingerprint: string
  preview_json: string
  status: 'ready' | 'confirmed' | 'cancelled' | 'stale'
  created_at: number
  expires_at: number
}

export async function createPreview(ctx: Ctx, toolName: string, input: unknown): Promise<{ id: string; expiresAt: number; preview: Preview }> {
  const s = requireWallet(ctx)
  const tool = toolByName(toolName)
  if (tool.kind !== 'prepare') throw new HttpError(400, 'not_a_prepare_tool', 'This tool reads data; it has no preview')
  rateLimit(`prepare:${s.accountId}`, 40, 600)
  const parsed = parseInput(tool, input)
  const preview = (await tool.run(ctx, parsed)) as Preview
  const id = randomToken(16)
  const now = nowSec()
  const stored: StoredPreview = { input: parsed, preview }
  await dbRun(
    `INSERT INTO action_previews (id, account_id, wallet, chain_id, contract, tool, fingerprint, preview_json, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
    id,
    s.accountId,
    s.wallet.toLowerCase(),
    env.chainId,
    env.escrow,
    tool.name,
    preview.fingerprint,
    JSON.stringify(stored),
    now,
    now + PREVIEW_TTL_SECONDS,
  )
  return { id, expiresAt: now + PREVIEW_TTL_SECONDS, preview }
}

async function loadPreview(ctx: Ctx, id: string): Promise<{ row: PreviewRow; stored: StoredPreview }> {
  const s = requireWallet(ctx)
  const row = await dbGet<PreviewRow>('SELECT * FROM action_previews WHERE id = ? AND account_id = ?', id, s.accountId)
  if (!row) throw notFound()
  return { row, stored: JSON.parse(row.preview_json) as StoredPreview }
}

function statusOf(row: PreviewRow): 'ready' | 'confirmed' | 'cancelled' | 'stale' | 'expired' {
  return row.status === 'ready' && row.expires_at <= nowSec() ? 'expired' : row.status
}

async function confirm(ctx: Ctx, id: string) {
  const s = requireWallet(ctx)
  rateLimit(`confirm:${s.accountId}`, 20, 600)
  const { row, stored } = await loadPreview(ctx, id)
  const st = statusOf(row)
  if (st === 'expired') throw new HttpError(410, 'preview_expired', 'This preview expired. Prepare it again.')
  if (st !== 'ready') throw new HttpError(409, 'preview_not_ready', `This preview is ${st}`)
  const stale = async () => {
    await dbRun("UPDATE action_previews SET status = 'stale' WHERE id = ?", id)
    return new HttpError(409, 'preview_stale', 'Something changed since this preview was made. Prepare it again.')
  }
  if (row.wallet !== s.wallet.toLowerCase() || row.chain_id !== env.chainId || row.contract !== env.escrow) throw await stale()
  // Re-run the same tool against the live state. If the facts it depends on moved, the preview is stale.
  const fresh = (await toolByName(row.tool).run(ctx, stored.input)) as Preview
  if (fresh.fingerprint !== row.fingerprint) throw await stale()

  const effect: Effect = stored.preview.effect
  const claimed = await dbRun("UPDATE action_previews SET status = 'confirmed', confirmed_at = ? WHERE id = ? AND status = 'ready'", nowSec(), id)
  if (claimed.changes === 0) throw new HttpError(409, 'preview_not_ready', 'This preview was already used')

  if (effect.type === 'server_write') {
    const result = await callRoute(ctx, effect.method, effect.path, effect.payload)
    return { status: 'done' as const, kind: effect.result, result, next: stored.preview.next ?? null }
  }
  let steps = effect.steps
  if (effect.note) {
    const { hash } = await saveNote(effect.note.publicId, s.wallet, effect.note.text)
    steps = steps.map((st2) => ({ ...st2, args: st2.args.map((a) => (a === '$noteHash' ? hash : a)) }))
  }
  return {
    status: 'sign' as const,
    steps,
    escrow: env.escrow,
    usdc: env.usdc,
    chainId: env.chainId,
    next: stored.preview.next ?? null,
  }
}

route('GET', '/assistant', (ctx) => {
  requireWallet(ctx)
  return {
    chat: { enabled: chatEnabled() },
    ttlSeconds: PREVIEW_TTL_SECONDS,
    tools: TOOLS.map((t) => ({ name: t.name, kind: t.kind, description: t.description, parameters: z.toJSONSchema(t.schema) })),
  }
})

route('POST', '/assistant', async (ctx) => {
  const s = requireWallet(ctx)
  rateLimit(`chat:${s.accountId}`, 20, 60)
  const input = await ctx.body(chatSchema)
  return runChat(ctx, input)
})

const prepareSchema = z.object({ tool: z.string().min(1).max(60), input: z.unknown().optional() })

route('GET', '/actions', async (ctx) => {
  const id = ctx.url.searchParams.get('id')
  if (!id) throw notFound()
  const { row, stored } = await loadPreview(ctx, id)
  return { id: row.id, status: statusOf(row), expiresAt: row.expires_at, preview: stored.preview }
})

route('POST', '/actions', async (ctx) => {
  const s = requireWallet(ctx)
  const op = ctx.url.searchParams.get('op')
  if (op === 'prepare') {
    const { tool, input } = await ctx.body(prepareSchema)
    const p = await createPreview(ctx, tool, input)
    return { id: p.id, status: 'ready', expiresAt: p.expiresAt, preview: p.preview }
  }
  if (op === 'read') {
    const { tool: name, input } = await ctx.body(prepareSchema)
    const tool = toolByName(name)
    if (tool.kind !== 'read') throw new HttpError(400, 'not_a_read_tool', 'This tool prepares an action')
    rateLimit(`read:${s.accountId}`, 120, 600)
    return { data: await tool.run(ctx, parseInput(tool, input)) }
  }
  const id = ctx.url.searchParams.get('id')
  if (!id) throw notFound()
  if (op === 'confirm') return confirm(ctx, id)
  if (op === 'cancel') {
    await loadPreview(ctx, id)
    await dbRun("UPDATE action_previews SET status = 'cancelled' WHERE id = ? AND account_id = ? AND status = 'ready'", id, s.accountId)
    return { status: 'cancelled' }
  }
  throw notFound()
})
