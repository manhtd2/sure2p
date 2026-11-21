import { getAddress, recoverTypedDataAddress, isAddressEqual, type Hex } from 'viem'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { audit, dbGet, dbRun, dbTx, nowSec } from '../db.js'
import { env } from '../env.js'
import {
  HttpError,
  notFound,
  rateLimit,
  requireNewTradeEligible,
  requireWallet,
  route,
  type Ctx,
} from '../http.js'
import { newDraftRef, randomToken } from '../lib/crypto.js'
import { createInvitation } from './invitations.js'
import { ATTACHMENT_MAX_BYTES, mimeForFilename } from '../../src/shared/files.js'
import { logFile, scanOrReject, serveProtected, vaultPut } from '../lib/vault.js'
import { MAX_ATTACH_BODY, MAX_DRAFT_FILES, attachmentsOf, draftFileResponse, missingAttachments } from '../lib/attachments.js'
import { matchesMime } from '../lib/evidenceFile.js'
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
  // Only the Buyer describes the goods they want to buy.
  if (attachmentsOf(terms).length > 0 && role !== 'buyer') {
    throw new HttpError(403, 'attachments_buyer_only', 'Only the Buyer can attach description files')
  }
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
  // ?attachment=<sha256> downloads a description file referenced by any version of this draft.
  const attachment = ctx.url.searchParams.get('attachment')
  if (attachment) {
    const versions = await listVersions(draft.id)
    const referenced = versions.some((v) => attachmentsOf(parseTerms(v.terms_json)).some((a) => a.sha256 === attachment))
    if (!referenced) throw notFound()
    return serveProtected(ctx, { kind: 'draft-attachment', ownerRef: draft.id, fileKey: attachment, load: () => draftFileResponse(draft.id, attachment) })
  }
  return draftView(draft, accountId)
})

/** The Buyer's account: the creator when they chose Buyer, otherwise whoever joined. */
function buyerAccountOf(draft: { creator_role: string; creator_account: string; counterparty_account: string | null }): string | null {
  return draft.creator_role === 'buyer' ? draft.creator_account : draft.counterparty_account
}

async function counterofferDraft(ctx: Ctx): Promise<{ versionId: string; version: number }> {
  const s = requireWallet(ctx)
  requireNewTradeEligible(s)
  const { draft, accountId } = await memberDraft(ctx, ctx.params.id)
  if (!MUTABLE.has(draft.status)) throw new HttpError(409, 'draft_locked', 'This agreement can no longer be changed')
  rateLimit(`counteroffer:${accountId}`, 30, 60 * 60)
  const { terms: rawTerms } = await ctx.body(counterofferSchema)
  const terms = validateTerms(rawTerms)
  const versionsNow = await listVersions(draft.id)
  const lastTerms = parseTerms(versionsNow[versionsNow.length - 1].terms_json)
  const key = (t: typeof terms) => attachmentsOf(t).map((a) => a.sha256).sort().join(',')
  if (key(terms) !== key(lastTerms) && buyerAccountOf(draft) !== accountId) {
    throw new HttpError(403, 'attachments_buyer_only', 'Only the Buyer can change the description files')
  }
  // The creator may revise their own draft before anyone claims it; after that both parties may counter.
  await dbRun("UPDATE agreement_versions SET status = 'superseded' WHERE draft_id = ? AND status = 'open'", draft.id)
  const version = await insertVersion(draft, accountId, terms)
  await touchDraft(draft.id, draft.counterparty_account ? 'negotiating' : draft.status)
  await audit(accountId, 'draft.counteroffer', draft.id, { version: version.version })
  return { versionId: version.id, version: version.version }
}

route('POST', '/drafts/:id/counteroffer', counterofferDraft)

/** Signing the typed agreement is the party's explicit acceptance of the exact version. */
async function signDraft(ctx: Ctx): Promise<{ signed: boolean; ready: boolean }> {
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
  if ((await missingAttachments(draft.id, terms)).length > 0) {
    throw new HttpError(409, 'attachments_missing', 'A description file has not been uploaded yet. The Buyer must upload it before signing.')
  }
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
}

route('POST', '/drafts/:id/sign', signDraft)

async function submitDraft(ctx: Ctx): Promise<{ ok: boolean }> {
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
}

route('POST', '/drafts/:id/submitted', submitDraft)

/** Allows a retry when createEscrow failed or the version expired before it was mined. */
async function reopenDraft(ctx: Ctx): Promise<{ ok: boolean }> {
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
}

route('POST', '/drafts/:id/reopen', reopenDraft)

const attachSchema = z.object({
  filename: z.string().trim().min(1).max(120),
  dataBase64: z.string().min(1),
})

/**
 * The Buyer uploads a description file for the goods. The file's hash goes into the terms that both
 * sides sign, so after signing it can no longer be swapped; bytes are stored once per hash and never updated.
 */
async function attachFile(ctx: Ctx): Promise<{ sha256: string; size: number; mime: string; duplicate: boolean; scan?: { verdict: string; reasons: string[] } }> {
  const s = requireWallet(ctx)
  const { draft, accountId } = await memberDraft(ctx, ctx.params.id)
  if (buyerAccountOf(draft) !== accountId) throw new HttpError(403, 'attachments_buyer_only', 'Only the Buyer can attach description files')
  if (!MUTABLE.has(draft.status)) throw new HttpError(409, 'draft_locked', 'This agreement can no longer be changed')
  rateLimit(`attach:${accountId}`, 30, 60 * 60)
  const body = await ctx.body(attachSchema, MAX_ATTACH_BODY)
  const mime = mimeForFilename(body.filename)
  if (!mime) throw new HttpError(400, 'unsupported_type', 'This file type is not accepted')
  const bytes = new Uint8Array(Buffer.from(body.dataBase64, 'base64'))
  if (bytes.length === 0) throw new HttpError(400, 'invalid_input', 'The file is empty')
  if (bytes.length > ATTACHMENT_MAX_BYTES) throw new HttpError(413, 'too_large', 'File is larger than 3 MB')
  if (!matchesMime(bytes, mime)) throw new HttpError(400, 'invalid_file', 'The file content does not match its type')
  const scan = await scanOrReject({ bytes, mime, account: accountId, scope: 'draft', ownerRef: draft.id })
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const existing = await dbGet('SELECT 1 AS x FROM draft_files WHERE draft_id = ? AND sha256 = ?', draft.id, sha256)
  if (existing) return { sha256, size: bytes.length, mime, duplicate: true }
  const count = await dbGet<{ n: number }>('SELECT COUNT(*) AS n FROM draft_files WHERE draft_id = ?', draft.id)
  if ((count?.n ?? 0) >= MAX_DRAFT_FILES) throw new HttpError(409, 'too_many_files', 'This draft already has the maximum number of files')
  const fileId = randomToken(12)
  await dbRun(
    `INSERT INTO draft_files (id, draft_id, sha256, filename, mime, size, content, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    fileId,
    draft.id,
    sha256,
    body.filename.replace(/[\\/\u0000-\u001f]/g, '_'),
    mime,
    bytes.length,
    new Uint8Array(0),
    accountId,
    nowSec(),
  )
  try {
    await vaultPut({ id: fileId, scope: 'draft', ownerRef: draft.id, sha256, bytes, scan })
  } catch (err) {
    await dbRun('DELETE FROM draft_files WHERE id = ?', fileId)
    throw err
  }
  await logFile(accountId, 'draft', draft.id, fileId, 'upload', { sha256, size: bytes.length, verdict: scan.verdict })
  await audit(accountId, 'draft.file_attached', draft.id, { sha256, size: bytes.length, wallet: s.wallet })
  return { sha256, size: bytes.length, mime, duplicate: false, scan: { verdict: scan.verdict, reasons: scan.reasons } }
}

route('POST', '/drafts/:id/attach', attachFile)

/**
 * The creator can delete a draft nobody has joined yet (a wrongly created invitation).
 * Once a counterparty has claimed the invitation, or the escrow transaction was submitted,
 * the draft is part of a shared deal and cannot be deleted.
 */
async function deleteDraft(ctx: Ctx): Promise<{ ok: boolean }> {
  const { draft, accountId } = await memberDraft(ctx, ctx.params.id)
  if (draft.creator_account !== accountId) throw notFound()
  if (draft.counterparty_account) throw new HttpError(409, 'draft_claimed', 'Someone has already joined this deal, so it cannot be deleted')
  if (draft.status === 'submitted' || draft.create_tx_hash) {
    throw new HttpError(409, 'draft_submitted', 'The escrow transaction was already submitted for this draft')
  }
  const created = await dbGet(
    'SELECT 1 AS x FROM escrows e JOIN agreement_versions v ON v.agreement_hash = e.agreement_hash WHERE v.draft_id = ?',
    draft.id,
  )
  if (created) throw new HttpError(409, 'already_created', 'The escrow already exists onchain')
  rateLimit(`draft-delete:${accountId}`, 30, 60 * 60)
  await dbTx(async () => {
    await dbRun('DELETE FROM invitations WHERE draft_id = ?', draft.id)
    await dbRun('DELETE FROM agreement_versions WHERE draft_id = ?', draft.id)
    await dbRun("DELETE FROM vault_objects WHERE scope = 'draft' AND id IN (SELECT id FROM draft_files WHERE draft_id = ?)", draft.id)
    await dbRun('DELETE FROM draft_files WHERE draft_id = ?', draft.id)
    await dbRun('DELETE FROM pending_txs WHERE draft_id = ?', draft.id)
    // The guard is repeated here so a counterparty claiming at the same moment wins and the delete rolls back.
    const res = await dbRun(
      'DELETE FROM drafts WHERE id = ? AND creator_account = ? AND counterparty_account IS NULL',
      draft.id,
      accountId,
    )
    if (res.changes !== 1) throw new HttpError(409, 'draft_claimed', 'Someone has already joined this deal, so it cannot be deleted')
  })
  await audit(accountId, 'draft.deleted', draft.id)
  return { ok: true }
}

route('POST', '/drafts/:id/delete', deleteDraft)

/**
 * Flattened alias (2026-11-17): POST /drafts/:id?action=counteroffer|sign|submitted|reopen|delete|attach.
 * The old /drafts/:id/<action> paths still work on the local dev server;
 * on Vercel they have no function file of their own, so the app calls this shape.
 */
route('POST', '/drafts/:id', async (ctx) => {
  const action = ctx.url.searchParams.get('action')
  if (action === 'counteroffer') return counterofferDraft(ctx)
  if (action === 'sign') return signDraft(ctx)
  if (action === 'submitted') return submitDraft(ctx)
  if (action === 'reopen') return reopenDraft(ctx)
  if (action === 'delete') return deleteDraft(ctx)
  if (action === 'attach') return attachFile(ctx)
  if (action === 'invitations') return createInvitation(ctx)
  throw notFound()
})
