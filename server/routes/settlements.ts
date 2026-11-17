import { isAddressEqual, getAddress, recoverTypedDataAddress, type Hex } from 'viem'
import { audit, dbAll, dbGet, dbRun, dbTx, nowSec } from '../db.js'
import { env } from '../env.js'
import { HttpError, rateLimit, requireWallet, route } from '../http.js'
import { newId } from '../lib/crypto.js'
import { memberEscrow } from './transactions.js'
import { escrowAbi } from '../../src/shared/escrowAbi.js'
import { publicClient } from '../indexer/index.js'
import {
  SETTLEMENT_VALIDITY_SECONDS,
  eip712Domain,
  settlementFromJson,
  settlementToJson,
  settlementTypes,
  type SettlementJson,
} from '../../src/shared/protocol.js'
import { createSettlementSchema, signSettlementSchema } from '../../src/shared/validation.js'

interface ProposalRow {
  id: string
  public_id: string
  proposed_by: string
  buyer_price_refund: string
  nonce: string
  deadline: number
  agreement_hash: string
  buyer_sig: string | null
  seller_sig: string | null
  status: 'open' | 'superseded' | 'executed'
  created_at: number
}

const SETTLEABLE = new Set(['active', 'overdue', 'disputed', 'preliminary_ruling', 'appealed'])

function proposalView(p: ProposalRow, escrowId: string) {
  const settlement: SettlementJson = settlementToJson({
    escrowId: BigInt(escrowId),
    buyerPriceRefund: BigInt(p.buyer_price_refund),
    nonce: BigInt(p.nonce),
    deadline: BigInt(p.deadline),
    agreementHash: p.agreement_hash as Hex,
  })
  return {
    id: p.id,
    status: p.status,
    settlement,
    buyerSig: p.buyer_sig,
    sellerSig: p.seller_sig,
    expired: p.deadline < nowSec(),
    createdAt: p.created_at,
  }
}

route('POST', '/transactions/:publicId/settlements', async (ctx) => {
  const s = requireWallet(ctx)
  const { row } = await memberEscrow(ctx, ctx.params.publicId)
  if (!SETTLEABLE.has(row.stage)) throw new HttpError(409, 'not_settleable', 'This deal cannot be settled in its current state')
  rateLimit(`settle-create:${s.accountId}`, 20, 60 * 60)
  const { buyerPriceRefund } = await ctx.body(createSettlementSchema)
  const refund = BigInt(buyerPriceRefund)
  if (refund > BigInt(row.price)) throw new HttpError(400, 'invalid_refund', 'Refund cannot exceed the price')

  // The nonce comes from the contract so a stale proposal can never be replayed.
  const onChain = await publicClient.readContract({
    address: env.escrow,
    abi: escrowAbi,
    functionName: 'getEscrow',
    args: [BigInt(row.on_chain_id)],
  })
  const id = newId()
  await dbTx(async () => {
    await dbRun("UPDATE settlement_proposals SET status = 'superseded' WHERE public_id = ? AND status = 'open'", row.public_id)
    await dbRun(
      `INSERT INTO settlement_proposals (id, public_id, proposed_by, buyer_price_refund, nonce, deadline, agreement_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      id,
      row.public_id,
      s.accountId,
      refund.toString(),
      onChain.settlementNonce.toString(),
      nowSec() + SETTLEMENT_VALIDITY_SECONDS,
      row.agreement_hash,
      nowSec(),
    )
  })
  await audit(s.accountId, 'settlement.proposed', row.public_id, { refund: refund.toString() })
  return { id }
})

route('GET', '/transactions/:publicId/settlements', async (ctx) => {
  const { row } = await memberEscrow(ctx, ctx.params.publicId)
  const rows = await dbAll<ProposalRow>(
    "SELECT * FROM settlement_proposals WHERE public_id = ? AND status != 'superseded' ORDER BY created_at DESC LIMIT 1",
    row.public_id,
  )
  const open = rows[0] ?? null
  const executed = row.stage === 'settled'
  return { proposal: open ? proposalView({ ...open, status: executed ? 'executed' : open.status }, row.on_chain_id) : null }
})

route('POST', '/transactions/:publicId/settlements/:id/sign', async (ctx) => {
  const s = requireWallet(ctx)
  const { row, role, wallet } = await memberEscrow(ctx, ctx.params.publicId)
  if (!SETTLEABLE.has(row.stage)) throw new HttpError(409, 'not_settleable', 'This deal cannot be settled in its current state')
  const { signature } = await ctx.body(signSettlementSchema)
  const proposal = await dbGet<ProposalRow>(
    "SELECT * FROM settlement_proposals WHERE id = ? AND public_id = ? AND status = 'open'",
    ctx.params.id,
    row.public_id,
  )
  if (!proposal) throw new HttpError(409, 'stale_proposal', 'This proposal was replaced. Review the latest one.')
  if (proposal.deadline < nowSec() + 60) throw new HttpError(409, 'proposal_expired', 'This proposal expired. Ask for a new one.')

  const signer = await recoverTypedDataAddress({
    domain: eip712Domain(env.chainId, env.escrow),
    types: settlementTypes,
    primaryType: 'Settlement',
    message: settlementFromJson(proposalView(proposal, row.on_chain_id).settlement),
    signature: signature as Hex,
  })
  if (!isAddressEqual(signer, getAddress(wallet))) throw new HttpError(400, 'bad_signature', 'Signature does not match your wallet')

  const col = role === 'buyer' ? 'buyer_sig' : 'seller_sig'
  await dbRun(`UPDATE settlement_proposals SET ${col} = ? WHERE id = ? AND status = 'open'`, signature, proposal.id)
  await audit(s.accountId, 'settlement.signed', row.public_id, { proposal: proposal.id, role })
  return { signed: true }
})
