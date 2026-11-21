/**
 * The assistant's 12 tools. Four read tools return facts the signed-in account may see. Eight prepare tools only build
 * a preview of something the account could do; they change nothing. Every tool takes the account and wallet from the
 * signed-in session, never from the caller's input.
 */
import { createHash, randomBytes } from 'node:crypto'
import { erc20Abi, getAddress, keccak256, toBytes } from 'viem'
import { z } from 'zod'
import { dbAll, dbGet, nowSec } from '../db.js'
import { env } from '../env.js'
import { HttpError, notFound, requireWallet, type Ctx } from '../http.js'
import { publicClient, indexerStatus } from '../indexer/index.js'
import { listVersions, memberDraft, parseTerms } from '../lib/deals.js'
import { rulingFor } from '../lib/rulings.js'
import { memberEscrow, type EscrowRow } from '../routes/transactions.js'
import { escrowAbi } from '../../src/shared/escrowAbi.js'
import { dealTermsSchema, handoverDeadlineError } from '../../src/shared/validation.js'
import { depositFor, type DealTerms } from '../../src/shared/protocol.js'
import { formatUsdc, parseUsdc } from '../../src/onchain-money.js'

export const PREVIEW_TTL_SECONDS = 300

export interface CallStep {
  to: 'escrow' | 'usdc'
  functionName: string
  args: string[]
  label: string
}

export type Effect =
  | { type: 'server_write'; method: 'POST'; path: string; payload: unknown; result: 'draft' | 'invitation' | 'version' | 'settlement' }
  | { type: 'wallet_call'; steps: CallStep[]; note?: { publicId: string; text: string } }

export interface Preview {
  tool: string
  title: string
  lines: string[]
  amounts: Array<{ label: string; value: string }>
  warnings: string[]
  effect: Effect
  /** Stable facts the preview depends on. A confirm re-checks them; if they changed the preview is stale. */
  fingerprint: string
  next?: { label: string; to: string }
}

const STATE = { Funding: 1, Active: 2, Overdue: 3, Disputed: 4, PreliminaryRuling: 5, Appealed: 6, Finalized: 7 } as const
const SETTLEABLE = new Set(['active', 'overdue', 'disputed', 'preliminary_ruling', 'appealed'])
const usdc = (n: bigint) => `${formatUsdc(n)} USDC`
const fp = (...parts: Array<string | number | bigint | boolean | null>) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
const publicIdSchema = z.string().regex(/^[0-9a-f]{12}$/, 'A public ID is 12 lowercase hex characters')
const usdcSchema = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/, 'Use a decimal amount with at most 6 decimals')

async function chainEscrow(row: EscrowRow) {
  return publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'getEscrow', args: [BigInt(row.on_chain_id)] })
}

async function titleOf(agreementHash: string): Promise<string> {
  const v = await dbGet<{ terms_json: string }>('SELECT terms_json FROM agreement_versions WHERE agreement_hash = ?', agreementHash)
  return v ? parseTerms(v.terms_json).title : ''
}

function myWallets(ctx: Ctx): Promise<string[]> {
  const s = requireWallet(ctx)
  return dbAll<{ address: string }>('SELECT address FROM wallet_links WHERE account_id = ?', s.accountId).then((r) => r.map((x) => x.address.toLowerCase()))
}

// ------------------------------------------------------------------ read tools

const getMyTransactionsInput = z.object({
  role: z.enum(['buyer', 'seller']).optional(),
  stage: z.string().max(40).optional(),
  page: z.number().int().min(1).max(50).optional(),
})
async function getMyTransactions(ctx: Ctx, input: z.infer<typeof getMyTransactionsInput>) {
  const wallets = await myWallets(ctx)
  const page = input.page ?? 1
  const size = 10
  if (wallets.length === 0) return { items: [], page, source: 'indexer' }
  const marks = wallets.map(() => '?').join(',')
  const rows = await dbAll<EscrowRow>(
    `SELECT * FROM escrows WHERE chain_id = ? AND contract = ? AND orphaned = 0
       AND (lower(buyer_wallet) IN (${marks}) OR lower(seller_wallet) IN (${marks})) ORDER BY created_at DESC`,
    env.chainId,
    env.escrow,
    ...wallets,
    ...wallets,
  )
  const mine = rows
    .map((r) => ({ r, role: wallets.includes(r.buyer_wallet.toLowerCase()) ? ('buyer' as const) : ('seller' as const) }))
    .filter((x) => (!input.role || x.role === input.role) && (!input.stage || x.r.stage === input.stage))
  const slice = mine.slice((page - 1) * size, page * size)
  const items = await Promise.all(
    slice.map(async ({ r, role }) => ({
      publicId: r.public_id,
      role,
      title: await titleOf(r.agreement_hash),
      stage: r.stage,
      price: usdc(BigInt(r.price)),
      handoverDeadline: r.handover_deadline,
    })),
  )
  return { items, page, total: mine.length, source: 'indexer', indexedThroughBlock: indexerStatus().cursor }
}

const publicIdInput = z.object({ publicId: publicIdSchema })

async function getTransactionDetails(ctx: Ctx, input: z.infer<typeof publicIdInput>) {
  const { row, role } = await memberEscrow(ctx, input.publicId)
  const v = await dbGet<{ terms_json: string }>('SELECT terms_json FROM agreement_versions WHERE agreement_hash = ?', row.agreement_hash)
  const terms = v ? parseTerms(v.terms_json) : null
  return {
    publicId: row.public_id,
    role,
    stage: row.stage,
    title: terms?.title ?? null,
    description: terms?.description ?? null,
    acceptanceCriteria: terms?.acceptanceCriteria ?? null,
    deliveryChannel: terms?.deliveryChannel ?? null,
    descriptionFiles: (terms?.attachments ?? []).map((a) => ({ name: a.name, size: a.size })),
    price: usdc(BigInt(row.price)),
    buyerDeposit: usdc(BigInt(row.buyer_deposit)),
    sellerDeposit: usdc(BigInt(row.seller_deposit)),
    fundingDeadline: row.funding_deadline,
    handoverDeadline: row.handover_deadline,
    buyerResponseSeconds: row.buyer_response_seconds,
    inspectionSeconds: row.inspection_seconds,
    source: 'indexer',
  }
}

async function getEscrowBalances(ctx: Ctx, input: z.infer<typeof publicIdInput>) {
  const { row, wallet } = await memberEscrow(ctx, input.publicId)
  const [e, claimable, block] = await Promise.all([
    chainEscrow(row),
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'claimable', args: [BigInt(row.on_chain_id), wallet] }),
    publicClient.getBlockNumber(),
  ])
  return {
    publicId: row.public_id,
    price: usdc(e.price),
    buyerDeposit: usdc(e.buyerDeposit),
    sellerDeposit: usdc(e.sellerDeposit),
    buyerFunded: e.buyerFunded,
    sellerFunded: e.sellerFunded,
    claimableByMyWallet: usdc(claimable),
    note: 'Claimable is released and waiting; it is not in your wallet until you claim it. Progress is time only and never an amount you can withdraw.',
    source: 'chain',
    atBlock: block.toString(),
  }
}

async function getDisputeStatus(ctx: Ctx, input: z.infer<typeof publicIdInput>) {
  const { row, role } = await memberEscrow(ctx, input.publicId)
  const ruling = await rulingFor(row.on_chain_id)
  const files = await dbGet<{ n: number }>('SELECT COUNT(*) AS n FROM evidence WHERE public_id = ?', row.public_id)
  const pick = (d: NonNullable<typeof ruling>['prelim'] | NonNullable<typeof ruling>['final']) =>
    d
      ? {
          buyerPriceRefund: usdc(BigInt(d.buyerPriceRefund)),
          buyerDepositRefund: usdc(BigInt(d.buyerDepositRefund)),
          sellerDepositRefund: usdc(BigInt(d.sellerDepositRefund)),
          buyerAtFault: d.buyerAtFault,
          sellerAtFault: d.sellerAtFault,
        }
      : null
  return {
    publicId: row.public_id,
    myRole: role,
    stage: row.stage,
    preliminary: ruling ? { ...pick(ruling.prelim), appealDeadline: ruling.prelim?.appealDeadline ?? null } : null,
    appealed: Boolean(ruling?.appeal),
    final: ruling?.final ? pick(ruling.final) : null,
    evidenceFileCount: files?.n ?? 0,
    source: 'indexer',
  }
}

// ---------------------------------------------------------------- prepare tools

const prepareAgreementInput = z.object({
  role: z.enum(['buyer', 'seller']),
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(2000),
  quantity: z.string().min(1).max(40),
  acceptanceCriteria: z.string().min(5).max(1000),
  deliveryChannel: z.string().min(2).max(200),
  priceUsdc: usdcSchema,
  handoverDeadlineIso: z.string().describe('Absolute date and time with a time zone, for example 2026-12-15T17:00:00+07:00'),
  buyerResponseHours: z.number().int().min(1).max(720).optional(),
  inspectionHours: z.number().int().min(1).max(720).optional(),
})
async function prepareAgreement(ctx: Ctx, input: z.infer<typeof prepareAgreementInput>): Promise<Preview> {
  requireWallet(ctx)
  const deadline = Math.floor(Date.parse(input.handoverDeadlineIso) / 1000)
  if (!Number.isFinite(deadline)) throw new HttpError(400, 'invalid_input', 'handoverDeadlineIso is not a valid date and time')
  const price = parseUsdc(input.priceUsdc)
  const terms = dealTermsSchema.safeParse({
    title: input.title.trim(),
    description: input.description.trim(),
    quantity: input.quantity.trim(),
    acceptanceCriteria: input.acceptanceCriteria.trim(),
    deliveryChannel: input.deliveryChannel.trim(),
    priceUnits: price.toString(),
    handoverDeadline: deadline,
    buyerResponseSeconds: (input.buyerResponseHours ?? 72) * 3600,
    inspectionSeconds: (input.inspectionHours ?? 72) * 3600,
  })
  if (!terms.success) throw new HttpError(400, 'invalid_input', terms.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const early = handoverDeadlineError(deadline, nowSec())
  if (early) throw new HttpError(400, 'invalid_input', 'The handover deadline must leave room for the 24 hour funding window')
  const deposit = depositFor(price)
  const warnings = ['This only saves a draft on the server. Nothing happens onchain and no signature or funds are requested.', 'Goods are exchanged outside sure2p.']
  if (price % 4n !== 0n) warnings.push('The deposit was rounded up, so the real deposit is slightly above 25%.')
  return {
    tool: 'prepareAgreement',
    title: `Create a draft as ${input.role}: ${terms.data.title}`,
    lines: [`Handover deadline: ${new Date(deadline * 1000).toISOString()}`, `Response window ${input.buyerResponseHours ?? 72} h, inspection window ${input.inspectionHours ?? 72} h`],
    amounts: [
      { label: 'Price', value: usdc(price) },
      { label: 'Buyer funds (price + 25% deposit)', value: usdc(price + deposit) },
      { label: 'Seller funds (25% deposit)', value: usdc(deposit) },
      { label: 'Total locked', value: usdc(price + 2n * deposit) },
    ],
    warnings,
    effect: { type: 'server_write', method: 'POST', path: '/drafts', payload: { role: input.role, terms: terms.data }, result: 'draft' },
    fingerprint: fp('agreement', requireWallet(ctx).accountId, JSON.stringify(terms.data), input.role),
  }
}

const draftIdInput = z.object({ draftId: z.string().min(6).max(40) })
async function prepareInvitation(ctx: Ctx, input: z.infer<typeof draftIdInput>): Promise<Preview> {
  const { draft } = await memberDraft(ctx, input.draftId)
  if (draft.counterparty_account) throw new HttpError(409, 'already_claimed', 'The other side already joined this draft')
  if (!['draft', 'invited', 'negotiating', 'ready'].includes(draft.status)) throw new HttpError(409, 'draft_locked', 'This draft can no longer be changed')
  return {
    tool: 'prepareInvitation',
    title: 'Create an invitation for the other side',
    lines: ['One link, one short code and one QR code share the same invitation.', 'It expires in 24 hours and only one account can claim it.', 'An invitation is not agreement: the other side can accept, counter or refuse.'],
    amounts: [],
    warnings: ['The link is shown once. Anyone who has it can try to claim it until it expires, so send it only to the other side.'],
    effect: { type: 'server_write', method: 'POST', path: `/drafts/${draft.id}?action=invitations`, payload: {}, result: 'invitation' },
    fingerprint: fp('invite', draft.id, draft.status),
  }
}

const prepareCounterofferInput = z.object({
  draftId: z.string().min(6).max(40),
  priceUsdc: usdcSchema.optional(),
  handoverDeadlineIso: z.string().optional(),
  title: z.string().min(3).max(120).optional(),
  description: z.string().min(10).max(2000).optional(),
  acceptanceCriteria: z.string().min(5).max(1000).optional(),
  deliveryChannel: z.string().min(2).max(200).optional(),
  quantity: z.string().min(1).max(40).optional(),
})
async function prepareCounteroffer(ctx: Ctx, input: z.infer<typeof prepareCounterofferInput>): Promise<Preview> {
  const { draft } = await memberDraft(ctx, input.draftId)
  if (!['draft', 'invited', 'negotiating', 'ready'].includes(draft.status)) throw new HttpError(409, 'draft_locked', 'This agreement can no longer be changed')
  const versions = await listVersions(draft.id)
  const latest = versions[versions.length - 1]
  const prev = parseTerms(latest.terms_json)
  const next: DealTerms = { ...prev }
  const changes: string[] = []
  const set = <K extends keyof DealTerms>(k: K, v: DealTerms[K] | undefined, label: string) => {
    if (v !== undefined && JSON.stringify(v) !== JSON.stringify(prev[k])) {
      next[k] = v
      changes.push(label)
    }
  }
  set('title', input.title?.trim(), 'title')
  set('description', input.description?.trim(), 'description')
  set('quantity', input.quantity?.trim(), 'quantity')
  set('acceptanceCriteria', input.acceptanceCriteria?.trim(), 'acceptance criteria')
  set('deliveryChannel', input.deliveryChannel?.trim(), 'delivery channel')
  if (input.priceUsdc) set('priceUnits', parseUsdc(input.priceUsdc).toString(), 'price')
  if (input.handoverDeadlineIso) {
    const d = Math.floor(Date.parse(input.handoverDeadlineIso) / 1000)
    if (!Number.isFinite(d)) throw new HttpError(400, 'invalid_input', 'handoverDeadlineIso is not a valid date and time')
    set('handoverDeadline', d, 'handover deadline')
  }
  if (changes.length === 0) throw new HttpError(400, 'no_change', 'Nothing differs from the current version')
  const valid = dealTermsSchema.safeParse(next)
  if (!valid.success) throw new HttpError(400, 'invalid_input', valid.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const early = handoverDeadlineError(valid.data.handoverDeadline, nowSec())
  if (early) throw new HttpError(400, 'invalid_input', 'The handover deadline must leave room for the 24 hour funding window')
  const price = BigInt(valid.data.priceUnits)
  const deposit = depositFor(price)
  return {
    tool: 'prepareCounteroffer',
    title: `Propose a new version (changes: ${changes.join(', ')})`,
    lines: changes.map((c) => `Changed: ${c}`),
    amounts: [
      { label: 'Price', value: usdc(price) },
      { label: 'Buyer funds', value: usdc(price + deposit) },
      { label: 'Seller funds', value: usdc(deposit) },
    ],
    warnings: ['A new version replaces the current one and cancels every acceptance and signature made on the old version. Both sides must sign the new version again.'],
    effect: { type: 'server_write', method: 'POST', path: `/drafts/${draft.id}?action=counteroffer`, payload: { terms: valid.data }, result: 'version' },
    fingerprint: fp('counter', draft.id, latest.id, JSON.stringify(valid.data)),
  }
}

async function prepareFunding(ctx: Ctx, input: z.infer<typeof publicIdInput>): Promise<Preview> {
  const { row, role, wallet } = await memberEscrow(ctx, input.publicId)
  const e = await chainEscrow(row)
  if (e.state !== STATE.Funding) throw new HttpError(409, 'wrong_state', 'This deal is not in the funding stage')
  if ((role === 'buyer' && e.buyerFunded) || (role === 'seller' && e.sellerFunded)) throw new HttpError(409, 'already_funded', 'Your part is already funded')
  const need = role === 'buyer' ? e.price + e.buyerDeposit : e.sellerDeposit
  const [balance, allowance] = await Promise.all([
    publicClient.readContract({ address: env.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
    publicClient.readContract({ address: env.usdc, abi: erc20Abi, functionName: 'allowance', args: [wallet, env.escrow] }),
  ])
  const steps: CallStep[] = []
  if (allowance < need) steps.push({ to: 'usdc', functionName: 'approve', args: [env.escrow, need.toString()], label: `Allow the contract to move exactly ${usdc(need)}` })
  steps.push({ to: 'escrow', functionName: role === 'buyer' ? 'fundBuyer' : 'fundSeller', args: [row.on_chain_id], label: `Fund ${usdc(need)}` })
  const warnings = ['The funding window closes 24 hours after the contract was created. If it is not fully funded in time, deposits are refunded with no penalty.']
  if (balance < need) warnings.push(`Your wallet holds ${usdc(balance)}, which is less than the ${usdc(need)} needed.`)
  return {
    tool: 'prepareFunding',
    title: `Fund your part as ${role}`,
    lines: [`Wallet ${wallet}`, `Funding deadline ${new Date(Number(e.fundingDeadline) * 1000).toISOString()}`, `Steps: ${steps.length} wallet transaction(s)`],
    amounts: [{ label: 'You fund', value: usdc(need) }, { label: 'Your wallet balance', value: usdc(balance) }],
    warnings,
    effect: { type: 'wallet_call', steps },
    fingerprint: fp('fund', row.public_id, role, e.state, need),
    next: { label: 'Open the deal', to: `/transactions/${row.public_id}` },
  }
}

const prepareConfirmationInput = z.object({
  publicId: publicIdSchema,
  kind: z.enum(['handover', 'receipt', 'accept', 'finalize']),
  note: z.string().max(500).optional().describe('For handover only: a short note about what was handed over and how'),
})
async function prepareConfirmation(ctx: Ctx, input: z.infer<typeof prepareConfirmationInput>): Promise<Preview> {
  const { row, role } = await memberEscrow(ctx, input.publicId)
  const e = await chainEscrow(row)
  const need = (cond: boolean, msg: string) => {
    if (!cond) throw new HttpError(409, 'wrong_state', msg)
  }
  need(e.state === STATE.Active, 'This deal is not active')
  let step: CallStep
  let title: string
  const lines: string[] = []
  const warnings: string[] = []
  if (input.kind === 'handover') {
    need(role === 'seller', 'Only the seller can declare handover')
    need(!e.sellerHandoverDeclared, 'Handover was already declared')
    const hash = keccak256(toBytes(`${(input.note ?? '').trim()}|${randomBytes(8).toString('hex')}`))
    step = { to: 'escrow', functionName: 'declareHandover', args: [row.on_chain_id, hash], label: 'Declare handover' }
    title = 'Declare that you handed the goods over'
    warnings.push('Your declaration is not proof that the buyer received anything. Only the buyer starts the inspection window.')
  } else if (input.kind === 'receipt') {
    need(role === 'buyer', 'Only the buyer can confirm receipt')
    need(e.sellerHandoverDeclared && !e.buyerReceiptAcknowledged, 'There is no handover waiting for your confirmation')
    step = { to: 'escrow', functionName: 'acknowledgeReceipt', args: [row.on_chain_id], label: 'Confirm receipt' }
    title = 'Confirm that you received the goods'
    warnings.push('This starts your inspection window. Confirm only if you really have the goods.')
  } else if (input.kind === 'accept') {
    need(role === 'buyer', 'Only the buyer can accept the goods')
    need(!e.buyerAccepted, 'You already accepted')
    step = { to: 'escrow', functionName: 'confirmBuyerAcceptance', args: [row.on_chain_id], label: 'Accept the goods' }
    title = 'Accept the goods as matching the agreement'
    warnings.push('Accepting says the goods match the agreement. If they do not, open a dispute instead.')
  } else {
    need(e.buyerAccepted, 'The buyer has not accepted yet')
    step = { to: 'escrow', functionName: 'finalizeMutualCompletion', args: [row.on_chain_id], label: 'Finalize the deal' }
    title = 'Finalize the completed deal'
    lines.push('The seller gets 100% of the price even when this happens before the deadline. Both deposits are refunded in full.')
  }
  return {
    tool: 'prepareConfirmation',
    title,
    lines,
    amounts: [{ label: 'Price', value: usdc(e.price) }],
    warnings,
    effect: { type: 'wallet_call', steps: [step] },
    fingerprint: fp('confirm', row.public_id, input.kind, role, e.state, e.buyerAcceptedAt, e.buyerAcknowledgedAt),
    next: { label: 'Open the deal', to: `/transactions/${row.public_id}` },
  }
}

const prepareSettlementInput = z.object({ publicId: publicIdSchema, buyerRefundUsdc: usdcSchema })
async function prepareMutualSettlement(ctx: Ctx, input: z.infer<typeof prepareSettlementInput>): Promise<Preview> {
  const { row } = await memberEscrow(ctx, input.publicId)
  if (!SETTLEABLE.has(row.stage)) throw new HttpError(409, 'not_settleable', 'This deal cannot be settled in its current state')
  const refund = parseUsdc(input.buyerRefundUsdc)
  const price = BigInt(row.price)
  if (refund > price) throw new HttpError(400, 'invalid_refund', 'The refund cannot exceed the price')
  const bd = BigInt(row.buyer_deposit)
  const sd = BigInt(row.seller_deposit)
  return {
    tool: 'prepareMutualSettlement',
    title: 'Propose a mutual settlement',
    lines: ['Both sides must sign the same split. Nothing moves until both have signed and one of you executes it.', 'Both deposits are refunded in full and the penalty is zero.'],
    amounts: [
      { label: 'Buyer receives (refund + full deposit)', value: usdc(refund + bd) },
      { label: 'Seller receives (rest of price + full deposit)', value: usdc(price - refund + sd) },
      { label: 'Penalty wallet', value: usdc(0n) },
      { label: 'Total', value: usdc(price + bd + sd) },
    ],
    warnings: ['This creates a proposal on the server. The other side sees it and can ignore it or counter.'],
    effect: { type: 'server_write', method: 'POST', path: `/transactions/${row.public_id}/settlements`, payload: { buyerPriceRefund: refund.toString() }, result: 'settlement' },
    fingerprint: fp('settle', row.public_id, row.stage, refund),
    next: { label: 'Open the deal to sign', to: `/transactions/${row.public_id}` },
  }
}

const prepareDisputeInput = z.object({
  publicId: publicIdSchema,
  kind: z.enum(['dispute', 'appeal']),
  reason: z.string().min(10).max(2000).describe("The account holder's own words. Do not invent or embellish."),
})
async function prepareDisputeOrAppeal(ctx: Ctx, input: z.infer<typeof prepareDisputeInput>): Promise<Preview> {
  const { row } = await memberEscrow(ctx, input.publicId)
  const e = await chainEscrow(row)
  const reason = input.reason.trim()
  if (input.kind === 'dispute') {
    if (e.state !== STATE.Active && e.state !== STATE.Overdue) throw new HttpError(409, 'wrong_state', 'A dispute can only be opened while the deal is active or overdue')
    const hash = keccak256(toBytes(`${reason}|${randomBytes(8).toString('hex')}`))
    return {
      tool: 'prepareDisputeOrAppeal',
      title: 'Open a dispute',
      lines: ['All funds stay locked. Nobody is penalized by opening a dispute.', 'Add your evidence in the deal after it is open.'],
      amounts: [],
      warnings: ['A human decides disputes, one case at a time. Nothing is released automatically.'],
      effect: { type: 'wallet_call', steps: [{ to: 'escrow', functionName: 'openDispute', args: [row.on_chain_id, hash], label: 'Open the dispute' }] },
      fingerprint: fp('dispute', row.public_id, e.state),
      next: { label: 'Open the deal', to: `/transactions/${row.public_id}` },
    }
  }
  const ruling = await rulingFor(row.on_chain_id)
  const deadline = ruling?.prelim?.appealDeadline ?? 0
  if (e.state !== STATE.PreliminaryRuling || !deadline || nowSec() > deadline) throw new HttpError(409, 'wrong_state', 'There is no preliminary ruling open for appeal')
  return {
    tool: 'prepareDisputeOrAppeal',
    title: 'Appeal the preliminary ruling',
    lines: [`Appeal window ends ${new Date(deadline * 1000).toISOString()} (72 hours after the ruling).`, 'Only one appeal is possible, for the whole case. A different reviewer then rules and that ruling is final.'],
    amounts: [],
    warnings: ['The reviewer can change the outcome in either direction within the contract limits.'],
    effect: {
      type: 'wallet_call',
      steps: [{ to: 'escrow', functionName: 'appeal', args: [row.on_chain_id, '$noteHash'], label: 'Appeal' }],
      note: { publicId: row.public_id, text: reason },
    },
    fingerprint: fp('appeal', row.public_id, e.state, deadline),
    next: { label: 'Open the deal', to: `/transactions/${row.public_id}` },
  }
}

async function prepareClaim(ctx: Ctx, input: z.infer<typeof publicIdInput>): Promise<Preview> {
  const { row, wallet } = await memberEscrow(ctx, input.publicId)
  const amount = await publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'claimable', args: [BigInt(row.on_chain_id), wallet] })
  if (amount === 0n) throw new HttpError(409, 'nothing_to_claim', 'Nothing is waiting for your wallet in this deal')
  return {
    tool: 'prepareClaim',
    title: 'Claim your funds',
    lines: [`Funds go only to your own wallet ${getAddress(wallet)}, the one fixed in the agreement.`],
    amounts: [{ label: 'Waiting for your wallet', value: usdc(amount) }],
    warnings: ['Until you claim, the money is released but not yet in your wallet. The network fee is paid from your wallet.'],
    effect: { type: 'wallet_call', steps: [{ to: 'escrow', functionName: 'claim', args: [row.on_chain_id], label: 'Claim' }] },
    fingerprint: fp('claim', row.public_id, wallet, amount),
    next: { label: 'Open the deal', to: `/transactions/${row.public_id}` },
  }
}

// -------------------------------------------------------------------- registry

interface ToolDef<I> {
  name: string
  kind: 'read' | 'prepare'
  description: string
  schema: z.ZodType<I>
  run: (ctx: Ctx, input: I) => Promise<unknown>
}

function def<I>(d: ToolDef<I>): ToolDef<unknown> {
  return d as unknown as ToolDef<unknown>
}

export const TOOLS: ToolDef<unknown>[] = [
  def({ name: 'getMyTransactions', kind: 'read', description: "List the signed-in user's own deals by public ID, with role, stage and price.", schema: getMyTransactionsInput, run: getMyTransactions }),
  def({ name: 'getTransactionDetails', kind: 'read', description: 'One deal of the signed-in user: signed terms, deadlines, role.', schema: publicIdInput, run: getTransactionDetails }),
  def({ name: 'getEscrowBalances', kind: 'read', description: 'Locked price, both deposits and what is waiting to be claimed, read from the chain at a block.', schema: publicIdInput, run: getEscrowBalances }),
  def({ name: 'getDisputeStatus', kind: 'read', description: 'Dispute or ruling state of one deal, with appeal deadline. Never returns evidence contents.', schema: publicIdInput, run: getDisputeStatus }),
  def({ name: 'prepareAgreement', kind: 'prepare', description: 'Prepare creating a draft agreement. Asks nothing of the wallet.', schema: prepareAgreementInput, run: prepareAgreement }),
  def({ name: 'prepareInvitation', kind: 'prepare', description: 'Prepare an invitation (link, code and QR) for an unclaimed draft.', schema: draftIdInput, run: prepareInvitation }),
  def({ name: 'prepareCounteroffer', kind: 'prepare', description: 'Prepare a new version of a draft with changed terms. Cancels earlier signatures.', schema: prepareCounterofferInput, run: prepareCounteroffer }),
  def({ name: 'prepareFunding', kind: 'prepare', description: 'Prepare funding the signed-in side of a deal (allowance and fund).', schema: publicIdInput, run: prepareFunding }),
  def({ name: 'prepareConfirmation', kind: 'prepare', description: 'Prepare declaring handover (seller) or confirming receipt, accepting the goods or finalizing (buyer).', schema: prepareConfirmationInput, run: prepareConfirmation }),
  def({ name: 'prepareMutualSettlement', kind: 'prepare', description: 'Prepare a mutual settlement proposal: refund to the buyer, both deposits returned, no penalty.', schema: prepareSettlementInput, run: prepareMutualSettlement }),
  def({ name: 'prepareDisputeOrAppeal', kind: 'prepare', description: "Prepare opening a dispute or appealing a preliminary ruling, using the user's own reason.", schema: prepareDisputeInput, run: prepareDisputeOrAppeal }),
  def({ name: 'prepareClaim', kind: 'prepare', description: 'Prepare claiming released funds to the signed-in wallet.', schema: publicIdInput, run: prepareClaim }),
]

export function toolByName(name: string): ToolDef<unknown> {
  const t = TOOLS.find((x) => x.name === name)
  if (!t) throw notFound()
  return t
}

export function parseInput(tool: ToolDef<unknown>, input: unknown): unknown {
  const parsed = tool.schema.safeParse(input ?? {})
  if (!parsed.success) throw new HttpError(400, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return parsed.data
}
