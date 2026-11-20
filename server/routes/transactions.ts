import { getAddress, type Address } from 'viem'
import { dbAll, dbGet, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import { HttpError, notFound, requireSession, route, type Ctx } from '../http.js'
import { indexerStatus, publicClient, reconcile } from '../indexer/index.js'
import { escrowAbi } from '../../src/shared/escrowAbi.js'
import { isPublicId, overdueTriggerAt, type EscrowStage } from '../../src/shared/protocol.js'
import { parseTerms, type DraftRow, type VersionRow } from '../lib/deals.js'
import { historyFor, rulingFor } from '../lib/rulings.js'
import { pendingTxSchema } from '../../src/shared/validation.js'

export interface EscrowRow {
  public_id: string
  chain_id: number
  contract: string
  on_chain_id: string
  buyer_wallet: string
  seller_wallet: string
  agreement_hash: string
  policy_hash: string
  price: string
  buyer_deposit: string
  seller_deposit: string
  created_at: number
  funding_deadline: number
  handover_deadline: number
  buyer_response_seconds: number
  inspection_seconds: number
  stage: EscrowStage
  buyer_funded: number
  seller_funded: number
  activated_at: number | null
  seller_declared_at: number | null
  handover_manifest: string | null
  buyer_acknowledged_at: number | null
  buyer_accepted_at: number | null
  overdue_trigger: number
  dispute_opened_by: string | null
  settlement_nonce: number
  settled_buyer_refund: string | null
  creation_tx: string
}

/** Escrow access: exact chain + contract + the signed wallet of one of the two parties. Everything else is a 404. */
export async function memberEscrow(ctx: Ctx, publicId: string): Promise<{ row: EscrowRow; role: 'buyer' | 'seller'; wallet: Address }> {
  const s = requireSession(ctx)
  if (!isPublicId(publicId) || !s.wallet) throw notFound()
  const row = await dbGet<EscrowRow>(
    'SELECT * FROM escrows WHERE public_id = ? AND chain_id = ? AND contract = ? AND orphaned = 0',
    publicId,
    env.chainId,
    env.escrow,
  )
  if (!row) throw notFound()
  const wallet = getAddress(s.wallet)
  const role = wallet === getAddress(row.buyer_wallet) ? 'buyer' : wallet === getAddress(row.seller_wallet) ? 'seller' : null
  if (!role) throw notFound()
  return { row, role, wallet }
}

async function titleFor(agreementHash: string): Promise<string | null> {
  const v = await dbGet<Pick<VersionRow, 'terms_json'>>('SELECT terms_json FROM agreement_versions WHERE agreement_hash = ?', agreementHash)
  return v ? parseTerms(v.terms_json).title : null
}

export async function escrowView(row: EscrowRow, role: 'buyer' | 'seller' | 'admin') {
  const trigger = overdueTriggerAt(nowSec(), {
    handoverDeadline: row.handover_deadline,
    buyerResponseSeconds: row.buyer_response_seconds,
    inspectionSeconds: row.inspection_seconds,
    sellerHandoverDeclared: row.seller_declared_at !== null,
    sellerDeclaredAt: row.seller_declared_at ?? 0,
    buyerReceiptAcknowledged: row.buyer_acknowledged_at !== null,
    buyerAcknowledgedAt: row.buyer_acknowledged_at ?? 0,
    buyerAccepted: row.buyer_accepted_at !== null,
  })
  const v = await dbGet<Pick<VersionRow, 'terms_json'>>('SELECT terms_json FROM agreement_versions WHERE agreement_hash = ?', row.agreement_hash)
  const draft = await dbGet<{ id: string }>(
    'SELECT d.id FROM drafts d JOIN agreement_versions av ON av.draft_id = d.id WHERE av.agreement_hash = ?',
    row.agreement_hash,
  )
  return {
    kind: 'escrow' as const,
    publicId: row.public_id,
    /** Internal contract id: used only as a transaction parameter, never displayed. */
    onChainId: row.on_chain_id,
    draftRef: draft?.id ?? null,
    myRole: role,
    stage: row.stage,
    buyerWallet: row.buyer_wallet,
    sellerWallet: row.seller_wallet,
    price: row.price,
    buyerDeposit: row.buyer_deposit,
    sellerDeposit: row.seller_deposit,
    agreementHash: row.agreement_hash,
    policyHash: row.policy_hash,
    createdAt: row.created_at,
    fundingDeadline: row.funding_deadline,
    handoverDeadline: row.handover_deadline,
    buyerResponseSeconds: row.buyer_response_seconds,
    inspectionSeconds: row.inspection_seconds,
    buyerFunded: Boolean(row.buyer_funded),
    sellerFunded: Boolean(row.seller_funded),
    activatedAt: row.activated_at,
    sellerDeclaredAt: row.seller_declared_at,
    handoverManifest: row.handover_manifest,
    buyerAcknowledgedAt: row.buyer_acknowledged_at,
    buyerAcceptedAt: row.buyer_accepted_at,
    flaggedTrigger: row.overdue_trigger,
    /** Derived from the indexed state and the clock; the chain is authoritative. */
    effectiveOverdueTrigger: row.stage === 'active' ? trigger : 0,
    disputeOpenedBy: row.dispute_opened_by,
    settlementNonce: row.settlement_nonce,
    settledBuyerRefund: row.settled_buyer_refund,
    creationTx: row.creation_tx,
    ruling: await rulingFor(row.on_chain_id),
    terms: v ? parseTerms(v.terms_json) : null,
  }
}

route('GET', '/transactions', async (ctx) => {
  const s = requireSession(ctx)
  const wallets = (await dbAll<{ address: string }>('SELECT address FROM wallet_links WHERE account_id = ?', s.accountId)).map(
    (w) => w.address,
  )
  const drafts = await dbAll<DraftRow>(
    'SELECT * FROM drafts WHERE creator_account = ? OR counterparty_account = ? ORDER BY updated_at DESC',
    s.accountId,
    s.accountId,
  )

  const items: unknown[] = []
  for (const d of drafts) {
    const latest = await dbGet<{ terms_json: string; agreement_hash: string | null }>(
      'SELECT terms_json, agreement_hash FROM agreement_versions WHERE draft_id = ? ORDER BY version DESC LIMIT 1',
      d.id,
    )
    if (!latest) continue
    const escrow = await dbGet(
      `SELECT e.public_id FROM escrows e JOIN agreement_versions av ON av.agreement_hash = e.agreement_hash
       WHERE av.draft_id = ? AND e.orphaned = 0 AND e.chain_id = ? AND e.contract = ?`,
      d.id,
      env.chainId,
      env.escrow,
    )
    if (escrow) continue // shown through its on-chain escrow below
    const terms = parseTerms(latest.terms_json)
    items.push({
      kind: 'draft',
      ref: d.id,
      status: d.status,
      title: terms.title,
      price: terms.priceUnits,
      myRole: d.creator_account === s.accountId ? d.creator_role : d.creator_role === 'buyer' ? 'seller' : 'buyer',
      updatedAt: d.updated_at,
      /** The creator may delete a draft nobody has joined yet. */
      canDelete: d.creator_account === s.accountId && !d.counterparty_account && d.status !== 'submitted',
    })
  }
  if (wallets.length > 0) {
    const marks = wallets.map(() => '?').join(',')
    const rows = await dbAll<EscrowRow>(
      `SELECT * FROM escrows WHERE orphaned = 0 AND chain_id = ? AND contract = ?
       AND (buyer_wallet IN (${marks}) OR seller_wallet IN (${marks})) ORDER BY created_at DESC`,
      env.chainId,
      env.escrow,
      ...wallets,
      ...wallets,
    )
    for (const row of rows) {
      const role = wallets.includes(row.buyer_wallet) ? 'buyer' : 'seller'
      items.push({ ...(await escrowView(row, role)), title: await titleFor(row.agreement_hash) })
    }
  }
  return { items }
})

route('GET', '/transactions/:publicId', async (ctx) => {
  const { row, role } = await memberEscrow(ctx, ctx.params.publicId)
  return escrowView(row, role)
})

route('GET', '/transactions/:publicId/history', async (ctx) => {
  const { row } = await memberEscrow(ctx, ctx.params.publicId)
  return { events: await historyFor(row.on_chain_id) }
})

/** Chain-derived amounts, labeled with the block they were read at. */
route('GET', '/transactions/:publicId/balances', async (ctx) => {
  const { row, wallet } = await memberEscrow(ctx, ctx.params.publicId)
  const id = BigInt(row.on_chain_id)
  const [escrow, claimable, blockNumber] = await Promise.all([
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'getEscrow', args: [id] }),
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'claimable', args: [id, wallet] }),
    publicClient.getBlockNumber(),
  ])
  const heldBuyer = escrow.buyerFunded ? escrow.price + escrow.buyerDeposit : 0n
  const heldSeller = escrow.sellerFunded ? escrow.sellerDeposit : 0n
  return {
    source: 'chain',
    blockNumber: blockNumber.toString(),
    onChainState: Number(escrow.state),
    priceLocked: escrow.buyerFunded ? escrow.price.toString() : '0',
    buyerFundedAmount: heldBuyer.toString(),
    sellerFundedAmount: heldSeller.toString(),
    claimable: claimable.toString(),
    withdrawableBeforeConfirmation: '0',
  }
})

/** Reconciles a wallet-submitted transaction by reading its real receipt. */
route('POST', '/transactions/:publicId/tx', async (ctx) => {
  const { row } = await memberEscrow(ctx, ctx.params.publicId)
  const { txHash, action } = await ctx.body(pendingTxSchema)
  await dbRun(
    'INSERT OR IGNORE INTO pending_txs (tx_hash, account_id, public_id, action, created_at) VALUES (?, ?, ?, ?, ?)',
    txHash,
    ctx.session!.accountId,
    row.public_id,
    action,
    nowSec(),
  )
  return { ok: true }
})

async function txStatus(ctx: Ctx, txHash: string): Promise<{ status: string; blockNumber?: string }> {
  const { row } = await memberEscrow(ctx, ctx.params.publicId)
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw notFound()
  const known = await dbGet('SELECT 1 AS x FROM pending_txs WHERE tx_hash = ? AND public_id = ?', txHash, row.public_id)
  if (!known) throw notFound()
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` })
    return { status: receipt.status === 'success' ? 'confirmed' : 'reverted', blockNumber: receipt.blockNumber.toString() }
  } catch {
    return { status: 'pending' }
  }
}

route('GET', '/transactions/:publicId/tx/:txHash', async (ctx) => txStatus(ctx, ctx.params.txHash))

/**
 * Flattened alias (2026-11-17): GET /transactions/:publicId/tx?txHash=<hash>.
 * The old /tx/:txHash path still works on the local dev server;
 * on Vercel it has no function file of its own, so the app calls this shape.
 */
route('GET', '/transactions/:publicId/tx', async (ctx) => {
  const txHash = ctx.url.searchParams.get('txHash')
  if (!txHash) throw notFound()
  return txStatus(ctx, txHash)
})

route('GET', '/health', async () => {
  // On Vercel there is no background loop that reconciles, so refresh a stale reading here (two cheap reads).
  const before = indexerStatus().reconciliation
  if (!before || Date.now() - before.at > 30_000) await reconcile().catch(() => undefined)
  const s = indexerStatus()
  return {
    ok: s.lastError === null,
    indexer: {
      cursor: s.cursor,
      head: s.head,
      blocksBehind: s.behind,
      startBlock: s.startBlock,
      lastError: s.lastError,
      reconciliation: s.reconciliation,
    },
    otpProvider: env.otpProvider,
  }
})

export { HttpError }
