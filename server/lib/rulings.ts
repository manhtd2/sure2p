import { getAddress, type Address } from 'viem'
import { dbAll, dbGet } from '../db.js'
import { env } from '../env.js'
import { HttpError, notFound, requireWallet, type Ctx } from '../http.js'
import { publicClient } from '../indexer/index.js'
import { escrowAbi } from '../../src/shared/escrowAbi.js'

interface RulingRow {
  prelim_by: string | null
  prelim_at: number | null
  appeal_deadline: number | null
  prelim_refund: string | null
  prelim_fault: number | null
  prelim_penalty: string | null
  prelim_reason: string | null
  appealed_by: string | null
  appealed_at: number | null
  appeal_reason: string | null
  final_by: string | null
  final_refund: string | null
  final_fault: number | null
  final_penalty: string | null
  final_reason: string | null
  finalized_at: number | null
  finalized_by_appeal: number | null
}

export interface RulingDecision {
  by: string
  buyerPriceRefund: string
  fault: 0 | 1 | 2
  penalty: string
  reasonHash: string
}

export interface RulingView {
  /** Plain-text reasons keyed by the hash that was sent onchain. Only parties and admins ever receive this. */
  notes: Record<string, string>
  prelim: (RulingDecision & { at: number; appealDeadline: number }) | null
  appeal: { by: string; at: number; reasonHash: string } | null
  final: (RulingDecision & { at: number; byAppeal: boolean }) | null
}

/** Ruling projection for one escrow, or null before any ruling. */
export async function rulingFor(onChainId: string): Promise<RulingView | null> {
  const r = await dbGet<RulingRow>(
    'SELECT * FROM rulings WHERE chain_id = ? AND contract = ? AND on_chain_id = ?',
    env.chainId,
    env.escrow,
    onChainId,
  )
  if (!r || r.prelim_by === null) return null
  const hashes = [r.prelim_reason, r.appeal_reason, r.final_reason].filter((h): h is string => Boolean(h))
  const notes: Record<string, string> = {}
  for (const h of hashes) {
    const n = await dbGet<{ text: string }>('SELECT text FROM case_notes WHERE hash = ?', h)
    if (n) notes[h] = n.text
  }
  return {
    notes,
    prelim: {
      by: r.prelim_by,
      at: r.prelim_at ?? 0,
      appealDeadline: r.appeal_deadline ?? 0,
      buyerPriceRefund: r.prelim_refund ?? '0',
      fault: (r.prelim_fault ?? 0) as 0 | 1 | 2,
      penalty: r.prelim_penalty ?? '0',
      reasonHash: r.prelim_reason ?? '',
    },
    appeal: r.appealed_by ? { by: r.appealed_by, at: r.appealed_at ?? 0, reasonHash: r.appeal_reason ?? '' } : null,
    final:
      r.finalized_at !== null && r.final_by
        ? {
            by: r.final_by,
            at: r.finalized_at,
            byAppeal: r.finalized_by_appeal === 1,
            buyerPriceRefund: r.final_refund ?? '0',
            fault: (r.final_fault ?? 0) as 0 | 1 | 2,
            penalty: r.final_penalty ?? '0',
            reasonHash: r.final_reason ?? '',
          }
        : null,
  }
}

export async function historyFor(onChainId: string) {
  const events = await dbAll<{
    name: string
    block_number: number
    block_timestamp: number
    tx_hash: string
    log_index: number
    args_json: string
  }>(
    `SELECT name, block_number, block_timestamp, tx_hash, log_index, args_json FROM chain_events
     WHERE chain_id = ? AND contract = ? AND on_chain_id = ? ORDER BY block_number, log_index`,
    env.chainId,
    env.escrow,
    onChainId,
  )
  return events.map((e) => ({
    name: e.name,
    blockNumber: e.block_number,
    timestamp: e.block_timestamp,
    txHash: e.tx_hash,
    logIndex: e.log_index,
    args: JSON.parse(e.args_json) as Record<string, string>,
  }))
}

/** Evidence hashes the parties have anchored onchain for this escrow. */
export async function anchoredHashes(onChainId: string): Promise<Map<string, { txHash: string; at: number }>> {
  const rows = await dbAll<{ tx_hash: string; args_json: string }>(
    `SELECT tx_hash, args_json FROM chain_events WHERE chain_id = ? AND contract = ? AND on_chain_id = ? AND name = 'EvidenceAnchored'`,
    env.chainId,
    env.escrow,
    onChainId,
  )
  const out = new Map<string, { txHash: string; at: number }>()
  for (const r of rows) {
    const a = JSON.parse(r.args_json) as { evidenceHash: string; at: string }
    out.set(a.evidenceHash.toLowerCase(), { txHash: r.tx_hash, at: Number(a.at) })
  }
  return out
}

export type AdminRole = 'arbiter' | 'reviewer'

let roleCache: { at: number; arbiter: Address; reviewer: Address; penaltyWallet: Address } | null = null

/** Current onchain ruling roles. Cached briefly: the chain stays the source of truth. */
export async function chainRoles(): Promise<{ arbiter: Address; reviewer: Address; penaltyWallet: Address }> {
  if (roleCache && Date.now() - roleCache.at < 15_000) return roleCache
  const [arbiter, reviewer, penaltyWallet] = await Promise.all([
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'arbiter' }),
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'appealReviewer' }),
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'penaltyWallet' }),
  ])
  roleCache = { at: Date.now(), arbiter: getAddress(arbiter), reviewer: getAddress(reviewer), penaltyWallet: getAddress(penaltyWallet) }
  return roleCache
}

/** The signed-in wallet's ruling role, or null. */
export async function adminRoleOf(wallet: string | null): Promise<AdminRole | null> {
  if (!wallet) return null
  const roles = await chainRoles().catch(() => null)
  if (!roles) throw new HttpError(503, 'chain_unavailable', 'Cannot read ruling roles right now')
  const w = getAddress(wallet)
  return w === roles.arbiter ? 'arbiter' : w === roles.reviewer ? 'reviewer' : null
}

/** Admin access: a verified wallet that is the onchain arbiter or appeal reviewer. Everyone else gets a uniform 404. */
export async function requireAdmin(ctx: Ctx): Promise<{ role: AdminRole; wallet: Address }> {
  const s = requireWallet(ctx)
  const role = await adminRoleOf(s.wallet)
  if (!role) throw notFound()
  return { role, wallet: getAddress(s.wallet) }
}

/** True when the wallet is the contract's immutable penalty wallet. */
export async function isPenaltyWallet(wallet: string | null): Promise<boolean> {
  if (!wallet) return false
  const roles = await chainRoles().catch(() => null)
  if (!roles) throw new HttpError(503, 'chain_unavailable', 'Cannot read the penalty wallet right now')
  return getAddress(wallet) === roles.penaltyWallet
}
