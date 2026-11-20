/**
 * Event projections. Every handler is idempotent: replaying the full event log
 * rebuilds exactly the same escrow rows, so reorg recovery is a reset + replay.
 */
import { dbAll, dbGet, dbRun, dbTx } from '../db.js'
import { env } from '../env.js'
import { generatePublicId } from '../lib/crypto.js'

export interface StoredEvent {
  contract: string
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
  // Ruling-era events name the escrow `id`; the original events name it `escrowId`.
  const id = ev.args.escrowId ?? ev.args.id
  const key = [env.chainId, ev.contract, id] as const
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
        ev.contract,
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
    case 'PreliminaryRulingIssued':
      await dbRun(
        `INSERT INTO ruling_decisions (chain_id, contract, on_chain_id, prelim_by, prelim_at, appeal_deadline, prelim_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chain_id, contract, on_chain_id) DO UPDATE SET prelim_by = excluded.prelim_by,
           prelim_at = excluded.prelim_at, appeal_deadline = excluded.appeal_deadline, prelim_json = excluded.prelim_json`,
        ...key,
        ev.args.issuedBy,
        ev.blockTimestamp,
        Number(ev.args.appealDeadline),
        decisionJson(ev.args),
      )
      await update(key, "stage = 'preliminary_ruling'")
      return
    case 'RulingAppealed':
      await dbRun(
        `UPDATE ruling_decisions SET appealed_by = ?, appealed_at = ?, appeal_reason = ? WHERE chain_id = ? AND contract = ? AND on_chain_id = ?`,
        ev.args.by,
        ev.blockTimestamp,
        ev.args.reasonHash,
        ...key,
      )
      await update(key, "stage = 'appealed'")
      return
    case 'FinalRulingIssued':
      await dbRun(
        `UPDATE ruling_decisions SET final_by = ?, final_json = ? WHERE chain_id = ? AND contract = ? AND on_chain_id = ?`,
        ev.args.issuedBy,
        decisionJson(ev.args),
        ...key,
      )
      return
    case 'RulingFinalized': {
      const byAppeal = ev.args.byAppeal === 'true' ? 1 : 0
      // Without an appeal the preliminary ruling is the effective one.
      await dbRun(
        `UPDATE ruling_decisions SET finalized_at = ?, finalized_by_appeal = ?,
           final_by = COALESCE(final_by, prelim_by), final_json = COALESCE(final_json, prelim_json)
         WHERE chain_id = ? AND contract = ? AND on_chain_id = ?`,
        ev.blockTimestamp,
        byAppeal,
        ...key,
      )
      await update(key, "stage = 'ruled'")
      return
    }
    default:
      return // CreditAssigned, Claimed and EvidenceAnchored are history-only.
  }
}

/** The ruling fields shared by the preliminary and final events, stored as JSON. Booleans arrive as 'true'/'false'. */
function decisionJson(args: Record<string, string>): string {
  return JSON.stringify({
    buyerPriceRefund: args.buyerPriceRefund,
    buyerDepositRefund: args.buyerDepositRefund,
    sellerDepositRefund: args.sellerDepositRefund,
    buyerAtFault: args.buyerAtFault === 'true',
    sellerAtFault: args.sellerAtFault === 'true',
    buyerFraud: args.buyerFraud === 'true',
    sellerFraud: args.sellerFraud === 'true',
    reasonHash: args.reasonHash,
    evidenceRoot: args.evidenceRoot,
  })
}

async function update(key: readonly [number, string, string], set: string, ...values: Array<string | number>): Promise<void> {
  await dbRun(`UPDATE escrows SET ${set} WHERE chain_id = ? AND contract = ? AND on_chain_id = ?`, ...values, ...key)
}

/** Reset all projected state, then replay every stored event in chain order. */
export async function rebuildProjections(): Promise<void> {
  await dbTx(async () => {
    await dbRun('DELETE FROM ruling_decisions')
    await dbRun(
      `UPDATE escrows SET orphaned = 1, stage = 'funding', buyer_funded = 0, seller_funded = 0, activated_at = NULL,
         seller_declared_at = NULL, handover_manifest = NULL, buyer_acknowledged_at = NULL, buyer_accepted_at = NULL,
         overdue_trigger = 0, dispute_opened_by = NULL, settlement_nonce = 0, settled_buyer_refund = NULL`,
    )
    const rows = await dbAll<{ contract: string; name: string; block_number: number; block_timestamp: number; tx_hash: string; args_json: string }>(
      'SELECT contract, name, block_number, block_timestamp, tx_hash, args_json FROM chain_events ORDER BY block_number, log_index',
    )
    for (const r of rows) {
      await applyEvent({
        contract: r.contract,
        name: r.name,
        blockNumber: r.block_number,
        blockTimestamp: r.block_timestamp,
        txHash: r.tx_hash,
        args: JSON.parse(r.args_json),
      })
    }
  })
}
