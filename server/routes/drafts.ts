import { getAddress, recoverTypedDataAddress, isAddressEqual, type Hex } from 'viem'
import { audit, dbGet, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import {
  HttpError,
  rateLimit,
  requireNewTradeEligible,
  requireWallet,
  route,
} from '../http.js'
import { newDraftRef } from '../lib/crypto.js'
import {
  agreementFor,
  buyerWalletOf,
  draftView,
  insertVersion,
  listVersions,
  memberDraft,
  sellerWalletOf,
  touchDraft,
  validateTerms,
  parseTerms,
} from '../lib/deals.js'
import {
  agreementTypes,
  agreementFromJson,
  eip712Domain,
} from '../../src/shared/protocol.js'
import {
  counterofferSchema,
  createDraftSchema,
  handoverDeadlineError,
  signAgreementSchema,
  submittedTxSchema,
} from '../../src/shared/validation.js'

const MUTABLE = new Set(['draft', 'invited', 'negotiating', 'ready'])

route('POST', '/drafts', async (ctx) => {
  const s = requireWallet(ctx)
  requireNewTradeEligible(s)
  rateLimit(`draft-create:${s.accountId}`, 20, 60 * 60)
  const { role, terms: rawTerms } = await ctx.body(createDraftSchema)
  const terms = validateTerms(rawTerms)
  const id = newDraftRef()
  await dbRun(
    `INSERT INTO drafts (id, creator_account, creator_role, creator_wallet, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
    id,
    s.accountId,
    role,
    getAddress(s.wallet),
    nowSec(),
    nowSec(),
  )
  const draft = (await dbGet('SELECT * FROM drafts WHERE id = ?', id)) as Parameters<typeof insertVersion>[0]
  await insertVersion(draft, s.accountId, terms)
  await audit(s.accountId, 'draft.created', id, { role })
  return { id }
})

route('GET', '/drafts/:id', async (ctx) => {
  const { draft, accountId } = await memberDraft(ctx, ctx.params.id)
  return draftView(draft, accountId)
})

route('POST', '/drafts/:id/counteroffer', async (ctx) => {
  const s = requireWallet(ctx)
  requireNewTradeEligible(s)
  const { draft, accountId } = await memberDraft(ctx, ctx.params.id)
  if (!MUTABLE.has(draft.status)) throw new HttpError(409, 'draft_locked', 'This agreement can no longer be changed')
  rateLimit(`counteroffer:${accountId}`, 30, 60 * 60)
  const { terms: rawTerms } = await ctx.body(counterofferSchema)
  const terms = validateTerms(rawTerms)
  // The creator may revise their own draft before anyone claims it; after that both parties may counter.
  await dbRun("UPDATE agreement_versions SET status = 'superseded' WHERE draft_id = ? AND status = 'open'", draft.id)
  const version = await insertVersion(draft, accountId, terms)
  await touchDraft(draft.id, draft.counterparty_account ? 'negotiating' : draft.status)
  await audit(accountId, 'draft.counteroffer', draft.id, { version: version.version })
  return { versionId: version.id, version: version.version }
})

/** Signing the typed agreement is the party's explicit acceptance of the exact version. */
route('POST', '/drafts/:id/sign', async (ctx) => {
  const s = requireWallet(ctx)
  requireNewTradeEligible(s)
  const { draft, accountId } = await memberDraft(ctx, ctx.params.id)
  if (!MUTABLE.has(draft.status)) throw new HttpError(409, 'draft_locked', 'This agreement can no longer be signed')
  if (!draft.counterparty_account) throw new HttpError(409, 'not_claimed', 'Wait for the counterparty to join')
  rateLimit(`sign:${accountId}`, 30, 60 * 60)
  const { versionId, signature } = await ctx.body(signAgreementSchema)

  const versions = await listVersions(draft.id)
  const latest = versions[versions.length - 1]
  const v = versions.find((x) => x.id === versionId)
  if (!v || v.status !== 'open' || latest.id !== v.id || !v.agreement_hash) {
    throw new HttpError(409, 'stale_version', 'This version was replaced. Review the latest terms.')
  }
  if (v.sign_deadline < nowSec() + 60 * 60) {
    throw new HttpError(409, 'version_expired', 'This version is about to expire. Ask for a renewed version.')
  }
  const terms = parseTerms(v.terms_json)
  if (handoverDeadlineError(terms.handoverDeadline, nowSec())) {
    throw new HttpError(409, 'handover_deadline_too_soon', 'The handover deadline is too close. Counter with a later date.')
  }

  const buyer = buyerWalletOf(draft)
  const seller = sellerWalletOf(draft)
  if (!buyer || !seller) throw new HttpError(409, 'not_claimed', 'Wait for the counterparty to join')
  const wallet = getAddress(s.wallet)
  const side = isAddressEqual(wallet, getAddress(buyer)) ? 'buyer' : isAddressEqual(wallet, getAddress(seller)) ? 'seller' : null
  if (!side) throw new HttpError(403, 'wrong_wallet', 'Connect the wallet that is bound to this deal')

  const agreement = agreementFor(draft, v)
  if (!agreement) throw new HttpError(409, 'not_ready', 'Agreement is not ready')
  const signer = await recoverTypedDataAddress({
    domain: eip712Domain(env.chainId, env.escrow),
    types: agreementTypes,
    primaryType: 'Agreement',
    message: agreementFromJson(agreement),
    signature: signature as Hex,
  })
  if (!isAddressEqual(signer, wallet)) throw new HttpError(400, 'bad_signature', 'Signature does not match your wallet')

  const col = side === 'buyer' ? 'buyer' : 'seller'
  await dbRun(`UPDATE agreement_versions SET ${col}_sig = ?, ${col}_signed_at = ? WHERE id = ? AND status = 'open'`, signature, nowSec(), v.id)
  const after = await dbGet<{ buyer_sig: string | null; seller_sig: string | null }>(
    'SELECT buyer_sig, seller_sig FROM agreement_versions WHERE id = ?',
    v.id,
  )
  await touchDraft(draft.id, after!.buyer_sig && after!.seller_sig ? 'ready' : 'negotiating')
  await audit(accountId, 'agreement.signed', draft.id, { version: v.version, side, disclosureAcknowledged: true })
  return { signed: true, ready: Boolean(after!.buyer_sig && after!.seller_sig) }
})

route('POST', '/drafts/:id/submitted', async (ctx) => {
  const s = requireWallet(ctx)
  const { draft, accountId } = await memberDraft(ctx, ctx.params.id)
  const { txHash } = await ctx.body(submittedTxSchema)
  if (draft.status !== 'ready' && draft.status !== 'submitted') throw new HttpError(409, 'not_ready', 'Both signatures are required first')
  await dbRun('UPDATE drafts SET create_tx_hash = ?, status = ?, updated_at = ? WHERE id = ?', txHash, 'submitted', nowSec(), draft.id)
  await dbRun(
    'INSERT OR IGNORE INTO pending_txs (tx_hash, account_id, draft_id, action, created_at) VALUES (?, ?, ?, ?, ?)',
    txHash,
    accountId,
    draft.id,
    'createEscrow',
    nowSec(),
  )
  await audit(accountId, 'escrow.create_submitted', draft.id, { txHash, wallet: s.wallet })
  return { ok: true }
})

/** Allows a retry when createEscrow failed or the version expired before it was mined. */
route('POST', '/drafts/:id/reopen', async (ctx) => {
  requireWallet(ctx)
  const { draft, accountId } = await memberDraft(ctx, ctx.params.id)
  const created = await dbGet(
    'SELECT 1 AS x FROM escrows e JOIN agreement_versions v ON v.agreement_hash = e.agreement_hash WHERE v.draft_id = ?',
    draft.id,
  )
  if (created) throw new HttpError(409, 'already_created', 'The escrow already exists on-chain')
  if (draft.status === 'submitted') await touchDraft(draft.id, 'ready')
  await audit(accountId, 'draft.reopened', draft.id)
  return { ok: true }
})
