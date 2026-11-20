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
  prelim_json: string | null
  appealed_by: string | null
  appealed_at: number | null
  appeal_reason: string | null
  final_by: string | null
  final_json: string | null
  finalized_at: number | null
  finalized_by_appeal: number | null
}

/** Everything the Arbiter or Appeal Reviewer sets in one ruling (spec F16 and F18). Amounts are USDC base units as strings. */
export interface RulingFields {
  buyerPriceRefund: string
  buyerDepositRefund: string
  sellerDepositRefund: string
  buyerAtFault: boolean
  sellerAtFault: boolean
  buyerFraud: boolean
  sellerFraud: boolean
  reasonHash: string
  evidenceRoot: string
}

export type RulingDecision = RulingFields & { by: string }

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
    'SELECT * FROM ruling_decisions WHERE chain_id = ? AND contract = ? AND on_chain_id = ?',
    env.chainId,
    env.escrow,
    onChainId,
  )
  if (!r || r.prelim_by === null || r.prelim_json === null) return null
  const prelim = JSON.parse(r.prelim_json) as RulingFields
  const final = r.final_json ? (JSON.parse(r.final_json) as RulingFields) : null
  const hashes = [prelim.reasonHash, r.appeal_reason, final?.reasonHash].filter((h): h is string => Boolean(h))
  const notes: Record<string, string> = {}
  for (const h of hashes) {
    const n = await dbGet<{ text: string }>('SELECT text FROM case_notes WHERE hash = ?', h)
    if (n) notes[h] = n.text
  }
  return {
    notes,
    prelim: { ...prelim, by: r.prelim_by, at: r.prelim_at ?? 0, appealDeadline: r.appeal_deadline ?? 0 },
    appeal: r.appealed_by ? { by: r.appealed_by, at: r.appealed_at ?? 0, reasonHash: r.appeal_reason ?? '' } : null,
    final:
      r.finalized_at !== null && r.final_by && final
        ? { ...final, by: r.final_by, at: r.finalized_at, byAppeal: r.finalized_by_appeal === 1 }
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

let roleCache: { at: number; owner: Address; arbiter: Address; reviewer: Address; penaltyWallet: Address } | null = null

/** Current onchain ruling roles. Cached briefly: the chain stays the source of truth. */
export async function chainRoles(): Promise<{ owner: Address; arbiter: Address; reviewer: Address; penaltyWallet: Address }> {
  if (roleCache && Date.now() - roleCache.at < 15_000) return roleCache
  const [owner, arbiter, reviewer, penaltyWallet] = await Promise.all([
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'owner' }),
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'arbiter' }),
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'appealReviewer' }),
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'penaltyWallet' }),
  ])
  roleCache = { at: Date.now(), owner: getAddress(owner), arbiter: getAddress(arbiter), reviewer: getAddress(reviewer), penaltyWallet: getAddress(penaltyWallet) }
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

/**
 * Security admin for the APP-LEVEL account ban: the escrow contract's owner wallet (decision 2026-11-20, option 3).
 * The registry's own SECURITY_ROLE sits with a shared platform wallet and is not used here, so this never writes to
 * the registry. The ban only stops new deals for an account; it needs a final ruling that names fraud.
 */
export async function isSecurityAdmin(wallet: string | null): Promise<boolean> {
  if (!wallet) return false
  const roles = await chainRoles().catch(() => null)
  return roles ? getAddress(wallet) === roles.owner : false
}

/** Console access for the three kinds of operator: arbiter, appeal reviewer, or the security admin (the contract owner). */
export async function requireOperator(ctx: Ctx): Promise<{ wallet: Address; role: AdminRole | null; security: boolean }> {
  const s = requireWallet(ctx)
  const [role, security] = await Promise.all([adminRoleOf(s.wallet), isSecurityAdmin(s.wallet)])
  if (!role && !security) throw notFound()
  return { wallet: getAddress(s.wallet), role, security }
}
