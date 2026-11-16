/**
 * Event projections. Every handler is idempotent: replaying the full event log
 * rebuilds exactly the same escrow rows, so reorg recovery is a reset + replay.
 */
import { dbAll, dbGet, dbRun, dbTx } from '../db.js'
import { env } from '../env.js'
import { generatePublicId } from '../lib/crypto.js'

export interface StoredEvent {
  name: string
  blockNumber: number
  blockTimestamp: number
  txHash: string
  args: Record<string, string>
}

async function publicIdFree(id: string): Promise<boolean> {
  return !(await dbGet('SELECT 1 AS x FROM escrows WHERE public_id = ?', id))
}

async function newPublicId(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const id = generatePublicId()
    if (await publicIdFree(id)) return id
  }
  throw new Error('could not allocate a public id')
}

export async function applyEvent(ev: StoredEvent): Promise<void> {
  const id = ev.args.escrowId
  const key = [env.chainId, env.escrow, id] as const
  switch (ev.name) {
    case 'EscrowCreated': {
      const existing = await dbGet<{ public_id: string }>(
        'SELECT public_id FROM escrows WHERE chain_id = ? AND contract = ? AND on_chain_id = ?',
        ...key,
      )
      if (existing) {
        await dbRun(
          'UPDATE escrows SET orphaned = 0, creation_block = ?, creation_tx = ? WHERE chain_id = ? AND contract = ? AND on_chain_id = ?',
          ev.blockNumber,
          ev.txHash,
          ...key,
        )
        return
      }
      await dbRun(
        `INSERT INTO escrows (public_id, chain_id, contract, on_chain_id, buyer_wallet, seller_wallet, agreement_hash, policy_hash,
           price, buyer_deposit, seller_deposit, created_at, funding_deadline, handover_deadline, buyer_response_seconds,
           inspection_seconds, creation_block, creation_tx)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        await newPublicId(),
        env.chainId,
        env.escrow,
        id,
        ev.args.buyer,
        ev.args.seller,
        ev.args.agreementHash,
        ev.args.policyHash,
        ev.args.price,
        ev.args.buyerDeposit,
        ev.args.sellerDeposit,
        ev.blockTimestamp,
        Number(ev.args.fundingDeadline),
        Number(ev.args.handoverDeadline),
        Number(ev.args.buyerResponseSeconds),
        Number(ev.args.inspectionSeconds),
        ev.blockNumber,
        ev.txHash,
      )
      return
    }
    case 'BuyerFunded':
      await update(key, 'buyer_funded = 1')
      return
    case 'SellerFunded':
      await update(key, 'seller_funded = 1')
      return
    case 'EscrowActivated':
      await update(key, "stage = 'active', activated_at = ?", Number(ev.args.activatedAt))
      return
    case 'EscrowExpired':
      await update(key, "stage = 'expired_unfunded'")
      return
    case 'HandoverDeclared':
      await update(key, 'seller_declared_at = ?, handover_manifest = ?', Number(ev.args.sellerDeclaredAt), ev.args.manifestHash)
      return
    case 'ReceiptAcknowledged':
      await update(key, 'buyer_acknowledged_at = ?', Number(ev.args.buyerAcknowledgedAt))
      return
    case 'BuyerAcceptanceConfirmed':
      await update(
        key,
        'buyer_accepted_at = ?, buyer_acknowledged_at = COALESCE(buyer_acknowledged_at, ?)',
        Number(ev.args.buyerAcceptedAt),
        Number(ev.args.buyerAcceptedAt),
      )
      return
    case 'OverdueFlagged':
      await update(key, "stage = 'overdue', overdue_trigger = ?", Number(ev.args.trigger))
      return
    case 'MutualCompletionFinalized':
      await update(key, "stage = 'completed'")
      return
    case 'DisputeOpened':
      await update(key, "stage = 'disputed', dispute_opened_by = ?", ev.args.openedBy)
      return
    case 'MutualSettlementExecuted':
      await update(
        key,
        "stage = 'settled', settled_buyer_refund = ?, settlement_nonce = ?",
        ev.args.buyerPriceRefund,
        Number(ev.args.nonce) + 1,
      )
      return
    default:
      return // CreditAssigned and Claimed are history-only.
  }
}

async function update(key: readonly [number, string, string], set: string, ...values: Array<string | number>): Promise<void> {
  await dbRun(`UPDATE escrows SET ${set} WHERE chain_id = ? AND contract = ? AND on_chain_id = ?`, ...values, ...key)
}

/** Reset all projected state, then replay every stored event in chain order. */
export async function rebuildProjections(): Promise<void> {
  await dbTx(async () => {
    await dbRun(
      `UPDATE escrows SET orphaned = 1, stage = 'funding', buyer_funded = 0, seller_funded = 0, activated_at = NULL,
         seller_declared_at = NULL, handover_manifest = NULL, buyer_acknowledged_at = NULL, buyer_accepted_at = NULL,
         overdue_trigger = 0, dispute_opened_by = NULL, settlement_nonce = 0, settled_buyer_refund = NULL`,
    )
    const rows = await dbAll<{ name: string; block_number: number; block_timestamp: number; tx_hash: string; args_json: string }>(
      'SELECT name, block_number, block_timestamp, tx_hash, args_json FROM chain_events ORDER BY block_number, log_index',
    )
    for (const r of rows) {
      await applyEvent({
        name: r.name,
        blockNumber: r.block_number,
        blockTimestamp: r.block_timestamp,
        txHash: r.tx_hash,
        args: JSON.parse(r.args_json),
      })
    }
  })
}
