/**
 * Admin console API. Access is decided by the chain: the signed-in wallet must currently be the
 * escrow's arbiter or appeal reviewer. Rulings themselves are sent from that wallet, never by the server.
 */
import { audit, dbAll, dbGet, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import { HttpError, notFound, requireSession, requireWallet, route, type Ctx } from '../http.js'
import { chainRoles, adminRoleOf, historyFor, isPenaltyWallet, isSecurityAdmin, requireAdmin, requireOperator } from '../lib/rulings.js'
import { parseTerms, type VersionRow } from '../lib/deals.js'
import { OPEN_CASE_STAGES, isPublicId, overdueTriggerAt } from '../../src/shared/protocol.js'
import { getAddress, keccak256, toBytes, type Address } from 'viem'
import { z } from 'zod'
import { decryptPhone } from '../lib/crypto.js'
import { indexerStatus, publicClient } from '../indexer/index.js'
import { escrowAbi } from '../../src/shared/escrowAbi.js'
import { registryAbi } from '../../src/shared/registryAbi.js'
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
  return { role, penaltyWallet: await isPenaltyWallet(s.wallet), security: await isSecurityAdmin(s.wallet) }
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


/** Case counts by stage and the numbers an operator checks first. */
route('GET', '/admin/overview', async (ctx) => {
  const op = await requireOperator(ctx)
  const rows = await dbAll<{ stage: string; c: number }>(
    'SELECT stage, COUNT(*) AS c FROM escrows WHERE orphaned = 0 AND chain_id = ? AND contract = ? GROUP BY stage',
    env.chainId,
    env.escrow,
  )
  const active = await dbAll<EscrowRow>(
    `SELECT * FROM escrows WHERE orphaned = 0 AND chain_id = ? AND contract = ? AND stage = 'active'`,
    env.chainId,
    env.escrow,
  )
  const idx = indexerStatus()
  return {
    role: op.role,
    security: op.security,
    byStage: Object.fromEntries(rows.map((r) => [r.stage, Number(r.c)])),
    activeNeedingFlag: active.filter((r) => overdueNow(r) !== 0).length,
    reconciliation: idx.reconciliation,
    indexer: { blocksBehind: idx.behind, lastError: idx.lastError },
  }
})

/** Ruling and role events plus admin account actions, newest first. Read-only. */
route('GET', '/admin/audit', async (ctx) => {
  await requireOperator(ctx)
  const events = await dbAll<{ name: string; on_chain_id: string | null; block_number: number; block_timestamp: number; tx_hash: string; args_json: string }>(
    `SELECT name, on_chain_id, block_number, block_timestamp, tx_hash, args_json FROM chain_events
     WHERE chain_id = ? AND contract = ? AND name IN
       ('PreliminaryRulingIssued','RulingAppealed','FinalRulingIssued','RulingFinalized','ArbiterChanged','AppealReviewerChanged','OwnershipTransferStarted','OwnershipTransferred')
     ORDER BY block_number DESC, log_index DESC LIMIT 100`,
    env.chainId,
    env.escrow,
  )
  const actions = await dbAll<{ at: number; action: string; subject: string | null; detail: string | null }>(
    `SELECT at, action, subject, detail FROM audit_log WHERE action LIKE 'account.%' OR action LIKE 'admin.%' ORDER BY id DESC LIMIT 100`,
  )
  const publicIds = new Map<string, string>()
  for (const e of events) {
    if (!e.on_chain_id || publicIds.has(e.on_chain_id)) continue
    const r = await dbGet<{ public_id: string }>(
      'SELECT public_id FROM escrows WHERE chain_id = ? AND contract = ? AND on_chain_id = ?',
      env.chainId,
      env.escrow,
      e.on_chain_id,
    )
    if (r) publicIds.set(e.on_chain_id, r.public_id)
  }
  return {
    events: events.map((e) => ({
      name: e.name,
      publicId: e.on_chain_id ? (publicIds.get(e.on_chain_id) ?? null) : null,
      blockNumber: e.block_number,
      timestamp: e.block_timestamp,
      txHash: e.tx_hash,
      args: JSON.parse(e.args_json) as Record<string, string>,
    })),
    actions,
  }
})

function maskPhone(enc: string): string | null {
  try {
    const p = decryptPhone(enc)
    return p.length > 6 ? `${p.slice(0, 3)}${'\u2022'.repeat(p.length - 5)}${p.slice(-2)}` : null
  } catch {
    return null
  }
}

interface FraudRow {
  on_chain_id: string
  public_id: string
  buyer_wallet: string
  seller_wallet: string
}

/** Wallets named as fraudulent by a FINAL ruling, checked against the contract's own `fraudConfirmed`. */
async function confirmedFraud() {
  const rows = await dbAll<FraudRow>(
    `SELECT e.on_chain_id, e.public_id, e.buyer_wallet, e.seller_wallet FROM ruling_decisions r
     JOIN escrows e ON e.chain_id = r.chain_id AND e.contract = r.contract AND e.on_chain_id = r.on_chain_id
     WHERE r.chain_id = ? AND r.contract = ? AND r.finalized_at IS NOT NULL AND e.orphaned = 0
       AND (r.final_json LIKE '%"buyerFraud":true%' OR r.final_json LIKE '%"sellerFraud":true%')`,
    env.chainId,
    env.escrow,
  )
  const out = []
  for (const r of rows) {
    const [buyerFraud, sellerFraud] = await publicClient.readContract({
      address: env.escrow,
      abi: escrowAbi,
      functionName: 'fraudConfirmed',
      args: [BigInt(r.on_chain_id)],
    })
    for (const [side, flagged, wallet] of [
      ['buyer', buyerFraud, r.buyer_wallet],
      ['seller', sellerFraud, r.seller_wallet],
    ] as const) {
      if (!flagged) continue
      const link = await dbGet<{ account_id: string }>('SELECT account_id FROM wallet_links WHERE address = ?', getAddress(wallet))
      const acct = link
        ? await dbGet<{ id: string; status: string; phone_enc: string }>('SELECT id, status, phone_enc FROM accounts WHERE id = ?', link.account_id)
        : null
      const registryBanned = await publicClient.readContract({
        address: env.registry,
        abi: registryAbi,
        functionName: 'banned',
        args: [getAddress(wallet) as Address],
      })
      out.push({
        publicId: r.public_id,
        side,
        wallet: getAddress(wallet),
        accountStatus: acct?.status ?? null,
        phoneMasked: acct ? maskPhone(acct.phone_enc) : null,
        registryBanned,
      })
    }
  }
  return out
}

route('GET', '/admin/accounts', async (ctx) => {
  const op = await requireOperator(ctx)
  return { security: op.security, items: await confirmedFraud() }
})

const banSchema = z.object({ publicId: z.string().length(12), side: z.enum(['buyer', 'seller']) })

/**
 * POST /admin/accounts?action=ban|unban. Security admin only (the contract owner wallet; app-level ban, never written to the registry). A ban needs the contract's
 * own `fraudConfirmed` to name that side; it only stops the account opening or joining NEW deals. Existing
 * deals and claims are untouched. The wallet-level ban in the registry is sent from the admin's own wallet.
 */
route('POST', '/admin/accounts', async (ctx) => {
  const op = await requireOperator(ctx)
  if (!op.security) throw new HttpError(403, 'security_role_required', 'Only the security admin (the contract owner) can change account bans')
  const action = ctx.url.searchParams.get('action')
  if (action !== 'ban' && action !== 'unban') throw notFound()
  rateLimit(`admin-ban:${op.wallet}`, 20, 600)
  const body = await ctx.body(banSchema)
  const hit = (await confirmedFraud()).find((i) => i.publicId === body.publicId && i.side === body.side)
  if (!hit) throw new HttpError(409, 'fraud_not_confirmed', 'The contract does not show a final ruling with a fraud flag for this side')
  const link = await dbGet<{ account_id: string }>('SELECT account_id FROM wallet_links WHERE address = ?', hit.wallet)
  if (!link) throw new HttpError(409, 'no_linked_account', 'No sure2p account is linked to this wallet')
  await dbRun('UPDATE accounts SET status = ? WHERE id = ?', action === 'ban' ? 'banned' : 'active', link.account_id)
  await audit(link.account_id, `account.${action}`, body.publicId, { side: body.side, by: op.wallet, reasonHash: keccak256(toBytes(`${body.publicId}:${body.side}`)) })
  return { ok: true }
})
