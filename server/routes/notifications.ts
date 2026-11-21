/**
 * In-app notifications, computed from real state on every read: deadlines that are close, things the other side
 * did, rulings, claims waiting. Nothing is pushed or stored except which items the account has already seen.
 */
import { z } from 'zod'
import { dbAll, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import { requireSession, route } from '../http.js'
import { adminRoleOf } from '../lib/rulings.js'
import type { EscrowRow } from './transactions.js'

type Severity = 'info' | 'warn' | 'urgent'

export interface NotificationItem {
  key: string
  kind: string
  publicId: string | null
  at: number
  severity: Severity
  params: Record<string, string | number>
  read: boolean
}

export interface TodoItem {
  key: string
  kind: string
  publicId: string | null
  draftId: string | null
  /** Who has to act next. 'me' means you; the rest are waiting rooms you can do nothing about. */
  waitingOn: 'me' | 'other' | 'arbiter' | 'reviewer' | 'anyone'
  deadline: number | null
  /** A prepare tool the assistant can open for this step, or null when the step is done in the deal page. */
  action: { tool: string; input: Record<string, string> } | null
}

const HOUR = 3600
const EVENT_WINDOW = 30 * 24 * HOUR

interface EventRow {
  name: string
  tx_hash: string
  log_index: number
  block_timestamp: number
  args_json: string
}

/** The sharpest reminder bucket that applies right now, or null when the deadline is far away or past. */
function bucket(remaining: number): '6h' | '24h' | null {
  if (remaining <= 0) return null
  if (remaining <= 6 * HOUR) return '6h'
  if (remaining <= 24 * HOUR) return '24h'
  return null
}

route('GET', '/notifications', async (ctx) => {
  const s = requireSession(ctx)
  const now = nowSec()
  const items: Omit<NotificationItem, 'read'>[] = []
  const add = (i: Omit<NotificationItem, 'read'>) => items.push(i)
  const todos: TodoItem[] = []
  const todo = (t: Omit<TodoItem, 'draftId'> & { draftId?: string | null }) => todos.push({ draftId: null, ...t })

  const wallets = (await dbAll<{ address: string }>('SELECT address FROM wallet_links WHERE account_id = ?', s.accountId)).map((w) =>
    w.address.toLowerCase(),
  )
  const mine = new Set(wallets)

  if (wallets.length > 0) {
    const marks = wallets.map(() => '?').join(',')
    const rows = await dbAll<EscrowRow>(
      `SELECT * FROM escrows WHERE chain_id = ? AND contract = ? AND orphaned = 0
         AND (lower(buyer_wallet) IN (${marks}) OR lower(seller_wallet) IN (${marks}))`,
      env.chainId,
      env.escrow,
      ...wallets,
      ...wallets,
    )
    for (const r of rows) {
      const isBuyer = mine.has(r.buyer_wallet.toLowerCase())
      const isSeller = mine.has(r.seller_wallet.toLowerCase())
      const pid = r.public_id

      // --- deadlines
      if (r.stage === 'funding') {
        const needs = (isBuyer && !r.buyer_funded) || (isSeller && !r.seller_funded)
        const b = bucket(r.funding_deadline - now)
        if (needs && b) add({ key: `${pid}:fund_due:${b}`, kind: 'fund_due', publicId: pid, at: now, severity: b === '6h' ? 'urgent' : 'warn', params: { deadline: r.funding_deadline } })
        if (r.funding_deadline <= now) add({ key: `${pid}:fund_expired`, kind: 'fund_expired', publicId: pid, at: r.funding_deadline, severity: 'warn', params: {} })
      }
      if (r.stage === 'active') {
        if (isSeller && !r.seller_declared_at) {
          const b = bucket(r.handover_deadline - now)
          if (b) add({ key: `${pid}:handover_due:${b}`, kind: 'handover_due', publicId: pid, at: now, severity: b === '6h' ? 'urgent' : 'warn', params: { deadline: r.handover_deadline } })
        }
        if (isBuyer && r.seller_declared_at && !r.buyer_acknowledged_at) {
          const due = r.seller_declared_at + r.buyer_response_seconds
          const b = bucket(due - now)
          if (b) add({ key: `${pid}:ack_due:${b}`, kind: 'ack_due', publicId: pid, at: now, severity: b === '6h' ? 'urgent' : 'warn', params: { deadline: due } })
        }
        if (isBuyer && r.buyer_acknowledged_at && !r.buyer_accepted_at) {
          const due = r.buyer_acknowledged_at + r.inspection_seconds
          const b = bucket(due - now)
          if (b) add({ key: `${pid}:accept_due:${b}`, kind: 'accept_due', publicId: pid, at: now, severity: b === '6h' ? 'urgent' : 'warn', params: { deadline: due } })
        }
        // Past a deadline but nobody has flagged it yet: both sides should know funds will be locked once flagged.
        if (!r.seller_declared_at && r.handover_deadline < now) add({ key: `${pid}:late_unflagged`, kind: 'late_unflagged', publicId: pid, at: r.handover_deadline, severity: 'urgent', params: {} })
      }
      if (r.stage === 'overdue' || r.stage === 'disputed') {
        add({ key: `${pid}:case_open:${r.stage}`, kind: 'case_open', publicId: pid, at: now, severity: 'warn', params: { stage: r.stage } })
      }

      // --- next step: who has to act, from real state
      const fundMine = (isBuyer && !r.buyer_funded) || (isSeller && !r.seller_funded)
      const act = (tool: string, extra: Record<string, string> = {}) => ({ tool, input: { publicId: pid, ...extra } })
      if (r.stage === 'funding') {
        if (r.funding_deadline > now) {
          todo(fundMine
            ? { key: `${pid}:t:fund`, kind: 'fund', publicId: pid, waitingOn: 'me', deadline: r.funding_deadline, action: act('prepareFunding') }
            : { key: `${pid}:t:wait_fund`, kind: 'wait_fund', publicId: pid, waitingOn: 'other', deadline: r.funding_deadline, action: null })
        } else {
          todo({ key: `${pid}:t:expire`, kind: 'expire', publicId: pid, waitingOn: 'anyone', deadline: null, action: null })
        }
      } else if (r.stage === 'active') {
        if (isSeller) {
          if (!r.seller_declared_at) todo({ key: `${pid}:t:handover`, kind: 'handover', publicId: pid, waitingOn: 'me', deadline: r.handover_deadline, action: act('prepareConfirmation', { kind: 'handover' }) })
          else if (!r.buyer_acknowledged_at) todo({ key: `${pid}:t:wait_ack`, kind: 'wait_ack', publicId: pid, waitingOn: 'other', deadline: r.seller_declared_at + r.buyer_response_seconds, action: null })
          else if (!r.buyer_accepted_at) todo({ key: `${pid}:t:wait_accept`, kind: 'wait_accept', publicId: pid, waitingOn: 'other', deadline: r.buyer_acknowledged_at + r.inspection_seconds, action: null })
          else todo({ key: `${pid}:t:finalize`, kind: 'finalize', publicId: pid, waitingOn: 'me', deadline: null, action: act('prepareConfirmation', { kind: 'finalize' }) })
        } else if (isBuyer) {
          if (!r.seller_declared_at) todo({ key: `${pid}:t:wait_handover`, kind: 'wait_handover', publicId: pid, waitingOn: 'other', deadline: r.handover_deadline, action: null })
          else if (!r.buyer_acknowledged_at) todo({ key: `${pid}:t:ack`, kind: 'ack', publicId: pid, waitingOn: 'me', deadline: r.seller_declared_at + r.buyer_response_seconds, action: act('prepareConfirmation', { kind: 'receipt' }) })
          else if (!r.buyer_accepted_at) todo({ key: `${pid}:t:accept`, kind: 'accept', publicId: pid, waitingOn: 'me', deadline: r.buyer_acknowledged_at + r.inspection_seconds, action: act('prepareConfirmation', { kind: 'accept' }) })
          else todo({ key: `${pid}:t:finalize`, kind: 'finalize', publicId: pid, waitingOn: 'me', deadline: null, action: act('prepareConfirmation', { kind: 'finalize' }) })
        }
        if (!r.seller_declared_at && r.handover_deadline < now) todo({ key: `${pid}:t:flag`, kind: 'flag_overdue', publicId: pid, waitingOn: 'anyone', deadline: null, action: null })
      } else if (r.stage === 'overdue' || r.stage === 'disputed') {
        todo({ key: `${pid}:t:case:${r.stage}`, kind: 'wait_arbiter', publicId: pid, waitingOn: 'arbiter', deadline: null, action: null })
      } else if (r.stage === 'appealed') {
        todo({ key: `${pid}:t:wait_reviewer`, kind: 'wait_reviewer', publicId: pid, waitingOn: 'reviewer', deadline: null, action: null })
      }

      // --- what happened (onchain events in the last 30 days)
      const ev = await dbAll<EventRow>(
        `SELECT name, tx_hash, log_index, block_timestamp, args_json FROM chain_events
          WHERE chain_id = ? AND contract = ? AND on_chain_id = ? AND block_timestamp > ?
            AND name IN ('BuyerFunded','SellerFunded','EscrowActivated','EscrowExpired','HandoverDeclared','ReceiptAcknowledged',
                         'BuyerAcceptanceConfirmed','MutualCompletionFinalized','OverdueFlagged','DisputeOpened','PreliminaryRulingIssued',
                         'RulingAppealed','RulingFinalized','MutualSettlementExecuted')`,
        env.chainId,
        env.escrow,
        r.on_chain_id,
        now - EVENT_WINDOW,
      )
      for (const e of ev) {
        const args = JSON.parse(e.args_json) as Record<string, string>
        const key = `${pid}:${e.name}:${e.tx_hash}:${e.log_index}`
        const base = { key, publicId: pid, at: e.block_timestamp }
        const actor = (args.openedBy ?? args.by ?? '').toLowerCase()
        const byMe = actor !== '' && mine.has(actor)
        switch (e.name) {
          case 'BuyerFunded': if (isSeller && !isBuyer) add({ ...base, kind: 'buyer_funded', severity: 'info', params: {} }); break
          case 'SellerFunded': if (isBuyer && !isSeller) add({ ...base, kind: 'seller_funded', severity: 'info', params: {} }); break
          case 'EscrowActivated': add({ ...base, kind: 'activated', severity: 'info', params: {} }); break
          case 'EscrowExpired': add({ ...base, kind: 'expired', severity: 'warn', params: {} }); break
          case 'HandoverDeclared': if (isBuyer && !isSeller) add({ ...base, kind: 'handover_declared', severity: 'warn', params: {} }); break
          case 'ReceiptAcknowledged': if (isSeller && !isBuyer) add({ ...base, kind: 'receipt_acknowledged', severity: 'info', params: {} }); break
          case 'BuyerAcceptanceConfirmed': if (isSeller && !isBuyer) add({ ...base, kind: 'buyer_accepted', severity: 'info', params: {} }); break
          case 'MutualCompletionFinalized': add({ ...base, kind: 'completed', severity: 'info', params: {} }); break
          case 'OverdueFlagged': add({ ...base, kind: 'overdue_flagged', severity: 'warn', params: {} }); break
          case 'DisputeOpened': if (!byMe) add({ ...base, kind: 'dispute_opened', severity: 'urgent', params: {} }); break
          case 'PreliminaryRulingIssued': add({ ...base, kind: 'ruling_preliminary', severity: 'urgent', params: { appealDeadline: Number(args.appealDeadline) } }); break
          case 'RulingAppealed': if (!byMe) add({ ...base, kind: 'ruling_appealed', severity: 'warn', params: {} }); break
          case 'RulingFinalized': add({ ...base, kind: 'ruling_final', severity: 'urgent', params: { byAppeal: args.byAppeal === 'true' ? 1 : 0 } }); break
          case 'MutualSettlementExecuted': add({ ...base, kind: 'settled', severity: 'info', params: {} }); break
        }
      }

      // --- appeal window closing (both parties)
      if (r.stage === 'preliminary_ruling') {
        const pre = ev.find((e) => e.name === 'PreliminaryRulingIssued')
        const deadline = pre ? Number((JSON.parse(pre.args_json) as Record<string, string>).appealDeadline) : 0
        const b = deadline ? bucket(deadline - now) : null
        if (b) add({ key: `${pid}:appeal_due:${b}`, kind: 'appeal_due', publicId: pid, at: now, severity: 'urgent', params: { deadline } })
        if (deadline && deadline > now) todo({ key: `${pid}:t:appeal_window`, kind: 'appeal_window', publicId: pid, waitingOn: 'me', deadline, action: act('prepareDisputeOrAppeal', { kind: 'appeal' }) })
        else todo({ key: `${pid}:t:finalize_ruling`, kind: 'finalize_ruling', publicId: pid, waitingOn: 'anyone', deadline: null, action: null })
      }
    }

    // --- claims waiting (credited minus claimed, summed per escrow for my wallets)
    const credits = await dbAll<{ on_chain_id: string; name: string; args_json: string; public_id: string | null }>(
      `SELECT ce.on_chain_id, ce.name, ce.args_json, e.public_id
         FROM chain_events ce LEFT JOIN escrows e ON e.on_chain_id = ce.on_chain_id AND e.chain_id = ce.chain_id AND e.contract = ce.contract
        WHERE ce.chain_id = ? AND ce.contract = ? AND ce.name IN ('CreditAssigned','Claimed')`,
      env.chainId,
      env.escrow,
    )
    const pending = new Map<string, { pid: string | null; amount: bigint }>()
    for (const c of credits) {
      const a = JSON.parse(c.args_json) as Record<string, string>
      if (!mine.has((a.account ?? '').toLowerCase())) continue
      const cur = pending.get(c.on_chain_id) ?? { pid: c.public_id, amount: 0n }
      cur.amount += c.name === 'CreditAssigned' ? BigInt(a.amount) : -BigInt(a.amount)
      pending.set(c.on_chain_id, cur)
    }
    for (const [id, p] of pending) {
      if (p.amount > 0n) {
        add({ key: `${p.pid ?? id}:claim_pending:${p.amount}`, kind: 'claim_pending', publicId: p.pid, at: now, severity: 'warn', params: { amount: p.amount.toString() } })
        if (p.pid) todo({ key: `${p.pid}:t:claim`, kind: 'claim', publicId: p.pid, waitingOn: 'me', deadline: null, action: { tool: 'prepareClaim', input: { publicId: p.pid } } })
      }
    }
  }

  // --- drafts: the other side joined
  const joined = await dbAll<{ id: string; updated_at: number }>(
    "SELECT id, updated_at FROM drafts WHERE creator_account = ? AND counterparty_account IS NOT NULL AND status NOT IN ('submitted','escrow_created','cancelled')",
    s.accountId,
  )
  const mineDrafts = await dbAll<{ id: string; status: string; counterparty_account: string | null }>(
    "SELECT id, status, counterparty_account FROM drafts WHERE (creator_account = ? OR counterparty_account = ?) AND status IN ('draft','invited','negotiating','ready','submitted')",
    s.accountId,
    s.accountId,
  )
  for (const d of mineDrafts) {
    const linked = await dbAll<{ n: number }>('SELECT COUNT(*) AS n FROM escrows e JOIN agreement_versions av ON av.agreement_hash = e.agreement_hash WHERE av.draft_id = ? AND e.orphaned = 0', d.id)
    if ((linked[0]?.n ?? 0) > 0) continue
    if (!d.counterparty_account) todo({ key: `${d.id}:t:invite`, kind: 'invite', publicId: null, draftId: d.id, waitingOn: 'me', deadline: null, action: { tool: 'prepareInvitation', input: { draftId: d.id } } })
    else if (d.status === 'submitted') todo({ key: `${d.id}:t:wait_escrow`, kind: 'wait_escrow', publicId: null, draftId: d.id, waitingOn: 'anyone', deadline: null, action: null })
    else if (d.status === 'ready') todo({ key: `${d.id}:t:create_escrow`, kind: 'create_escrow', publicId: null, draftId: d.id, waitingOn: 'me', deadline: null, action: null })
    else todo({ key: `${d.id}:t:sign`, kind: 'sign_agreement', publicId: null, draftId: d.id, waitingOn: 'me', deadline: null, action: null })
  }
  for (const d of joined) add({ key: `${d.id}:draft_joined`, kind: 'draft_joined', publicId: null, at: d.updated_at, severity: 'info', params: { draftId: d.id } })

  // --- operators
  if (s.wallet) {
    const role = await adminRoleOf(s.wallet).catch(() => null)
    if (role) {
      const stages = role === 'arbiter' ? ['overdue', 'disputed'] : ['appealed']
      const marks = stages.map(() => '?').join(',')
      const rows = await dbAll<{ n: number }>(
        `SELECT COUNT(*) AS n FROM escrows WHERE chain_id = ? AND contract = ? AND orphaned = 0 AND stage IN (${marks})`,
        env.chainId,
        env.escrow,
        ...stages,
      )
      const n = rows[0]?.n ?? 0
      if (n > 0) add({ key: `ops:${role}:${n}`, kind: 'ops_cases', publicId: null, at: now, severity: 'warn', params: { role, count: n } })
    }
  }

  const seen = new Set(
    (await dbAll<{ key: string }>('SELECT key FROM notification_reads WHERE account_id = ?', s.accountId)).map((r) => r.key),
  )
  const sorted = items
    .sort((a, b) => b.at - a.at)
    .slice(0, 80)
    .map((i) => ({ ...i, read: seen.has(i.key) }))
  const rank = (t: TodoItem) => (t.waitingOn === 'me' ? 0 : 1)
  todos.sort((a, b) => rank(a) - rank(b) || (a.deadline ?? Number.MAX_SAFE_INTEGER) - (b.deadline ?? Number.MAX_SAFE_INTEGER))
  return { items: sorted, unread: sorted.filter((i) => !i.read).length, todos: todos.slice(0, 30) }
})

const readSchema = z.object({ keys: z.array(z.string().min(1).max(200)).min(1).max(200) })

route('POST', '/notifications', async (ctx) => {
  const s = requireSession(ctx)
  const { keys } = await ctx.body(readSchema)
  const at = nowSec()
  for (const k of keys) {
    await dbRun('INSERT OR IGNORE INTO notification_reads (account_id, key, read_at) VALUES (?, ?, ?)', s.accountId, k, at)
  }
  return { ok: true }
})
