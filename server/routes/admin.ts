/**
 * Admin console API. Access is decided by the chain: the signed-in wallet must currently be the
 * escrow's arbiter or appeal reviewer. Rulings themselves are sent from that wallet, never by the server.
 */
import { dbAll, dbGet, nowSec } from '../db.js'
import { env } from '../env.js'
import { notFound, requireSession, requireWallet, route, type Ctx } from '../http.js'
import { chainRoles, adminRoleOf, historyFor, isPenaltyWallet, requireAdmin } from '../lib/rulings.js'
import { parseTerms, type VersionRow } from '../lib/deals.js'
import { OPEN_CASE_STAGES, isPublicId, overdueTriggerAt } from '../../src/shared/protocol.js'
import { z } from 'zod'
import { rateLimit } from '../http.js'
import { evidenceList, saveNote } from './evidence.js'
import { escrowView, type EscrowRow } from './transactions.js'

function overdueNow(row: EscrowRow): number {
  return overdueTriggerAt(nowSec(), {
    handoverDeadline: row.handover_deadline,
    buyerResponseSeconds: row.buyer_response_seconds,
    inspectionSeconds: row.inspection_seconds,
    sellerHandoverDeclared: row.seller_declared_at !== null,
    sellerDeclaredAt: row.seller_declared_at ?? 0,
    buyerReceiptAcknowledged: row.buyer_acknowledged_at !== null,
    buyerAcknowledgedAt: row.buyer_acknowledged_at ?? 0,
    buyerAccepted: row.buyer_accepted_at !== null,
  })
}

/** Tells the console what the signed-in wallet may do. Never errors for a normal user. */
route('GET', '/admin/me', async (ctx) => {
  const s = requireSession(ctx)
  const role = await adminRoleOf(s.wallet)
  return { role, penaltyWallet: await isPenaltyWallet(s.wallet) }
})

/**
 * Penalties paid to the penalty wallet, per escrow. Only that wallet may see this. Amounts come from
 * indexed events; the app reads the live claimable amount from the chain before sending a claim.
 */
route('GET', '/admin/penalty', async (ctx) => {
  const s = requireWallet(ctx)
  if (!(await isPenaltyWallet(s.wallet))) throw notFound()
  const wallet = s.wallet.toLowerCase()
  const events = await dbAll<{ on_chain_id: string; name: string; args_json: string }>(
    `SELECT on_chain_id, name, args_json FROM chain_events
     WHERE chain_id = ? AND contract = ? AND name IN ('CreditAssigned', 'Claimed') ORDER BY block_number, log_index`,
    env.chainId,
    env.escrow,
  )
  const byEscrow = new Map<string, { credited: bigint; claimed: bigint }>()
  for (const e of events) {
    const a = JSON.parse(e.args_json) as { account?: string; amount?: string }
    if (a.account?.toLowerCase() !== wallet || !e.on_chain_id) continue
    const row = byEscrow.get(e.on_chain_id) ?? { credited: 0n, claimed: 0n }
    if (e.name === 'CreditAssigned') row.credited += BigInt(a.amount ?? '0')
    else row.claimed += BigInt(a.amount ?? '0')
    byEscrow.set(e.on_chain_id, row)
  }
  const items = []
  for (const [onChainId, t] of byEscrow) {
    const esc = await dbGet<Pick<EscrowRow, 'public_id' | 'agreement_hash'>>(
      'SELECT public_id, agreement_hash FROM escrows WHERE chain_id = ? AND contract = ? AND on_chain_id = ?',
      env.chainId,
      env.escrow,
      onChainId,
    )
    const v = esc
      ? await dbGet<Pick<VersionRow, 'terms_json'>>('SELECT terms_json FROM agreement_versions WHERE agreement_hash = ?', esc.agreement_hash)
      : null
    items.push({
      onChainId,
      publicId: esc?.public_id ?? null,
      title: v ? parseTerms(v.terms_json).title : null,
      credited: t.credited.toString(),
      claimed: t.claimed.toString(),
    })
  }
  return { wallet: s.wallet, items }
})

route('GET', '/admin/roles', async (ctx) => {
  await requireAdmin(ctx)
  const roles = await chainRoles()
  return { arbiter: roles.arbiter, appealReviewer: roles.reviewer }
})

route('GET', '/admin/cases', async (ctx) => {
  const { role } = await requireAdmin(ctx)
  const marks = OPEN_CASE_STAGES.map(() => '?').join(',')
  const open = await dbAll<EscrowRow>(
    `SELECT * FROM escrows WHERE orphaned = 0 AND chain_id = ? AND contract = ? AND stage IN (${marks}) ORDER BY created_at DESC`,
    env.chainId,
    env.escrow,
    ...OPEN_CASE_STAGES,
  )
  // Active escrows whose deadline has passed but nobody has flagged yet: the arbiter can only rule after a flag.
  const active = await dbAll<EscrowRow>(
    `SELECT * FROM escrows WHERE orphaned = 0 AND chain_id = ? AND contract = ? AND stage = 'active'`,
    env.chainId,
    env.escrow,
  )
  const needsFlag = active.filter((r) => overdueNow(r) !== 0)
  const items = []
  for (const row of [...open, ...needsFlag]) {
    const view = await escrowView(row, 'admin')
    const v = await dbGet<Pick<VersionRow, 'terms_json'>>(
      'SELECT terms_json FROM agreement_versions WHERE agreement_hash = ?',
      row.agreement_hash,
    )
    items.push({
      publicId: row.public_id,
      title: v ? parseTerms(v.terms_json).title : null,
      stage: row.stage,
      price: row.price,
      buyerWallet: row.buyer_wallet,
      sellerWallet: row.seller_wallet,
      needsFlag: row.stage === 'active',
      ruling: view.ruling,
      /** What this role can do next. */
      actionable:
        (role === 'arbiter' && (row.stage === 'overdue' || row.stage === 'disputed')) ||
        (role === 'reviewer' && row.stage === 'appealed'),
    })
  }
  return { role, items }
})

route('GET', '/admin/cases/:publicId', async (ctx) => {
  const { role } = await requireAdmin(ctx)
  const s = requireWallet(ctx)
  const publicId = ctx.params.publicId
  if (!isPublicId(publicId)) throw notFound()
  const row = await dbGet<EscrowRow>(
    'SELECT * FROM escrows WHERE public_id = ? AND chain_id = ? AND contract = ? AND orphaned = 0',
    publicId,
    env.chainId,
    env.escrow,
  )
  if (!row) throw notFound()
  const view = await escrowView(row, 'admin')
  // The contract rejects a ruling by a party of the escrow; surface it so the console can explain why.
  const isParty = [row.buyer_wallet, row.seller_wallet].some((w) => w.toLowerCase() === s.wallet.toLowerCase())
  return {
    ...view,
    role,
    isParty,
    evidence: await evidenceList(row),
    history: await historyFor(row.on_chain_id),
  }
})

/** Stores the written reasoning behind a ruling and returns the hash the ruling transaction commits to. */
async function saveAdminNote(ctx: Ctx): Promise<{ hash: string }> {
  const { wallet } = await requireAdmin(ctx)
  const publicId = ctx.params.publicId
  if (!isPublicId(publicId)) throw notFound()
  const exists = await dbGet(
    'SELECT 1 AS x FROM escrows WHERE public_id = ? AND chain_id = ? AND contract = ? AND orphaned = 0',
    publicId,
    env.chainId,
    env.escrow,
  )
  if (!exists) throw notFound()
  rateLimit(`admin-notes:${wallet}`, 30, 600)
  const { text } = await ctx.body(z.object({ text: z.string().trim().min(10).max(2000) }))
  return saveNote(publicId, wallet, text)
}

route('POST', '/admin/cases/:publicId/notes', saveAdminNote)

/**
 * Flattened alias (2026-11-17): POST /admin/cases/:publicId?action=notes.
 * The old /admin/cases/:publicId/notes path still works on the local dev server;
 * on Vercel it has no function file of its own, so the app calls this shape.
 */
route('POST', '/admin/cases/:publicId', async (ctx) => {
  if (ctx.url.searchParams.get('action') === 'notes') return saveAdminNote(ctx)
  throw notFound()
})
