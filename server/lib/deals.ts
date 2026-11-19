import { getAddress, type Address, type Hex } from 'viem'
import { dbAll, dbGet, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import { missingAttachments } from './attachments.js'
import { HttpError, notFound, type Ctx } from '../http.js'
import { newId, randomHex } from './crypto.js'
import {
  agreementToJson,
  buildAgreementStruct,
  computeAgreementHash,
  SIGN_VALIDITY_SECONDS,
  type AgreementJson,
  type DealTerms,
} from '../../src/shared/protocol.js'
import { dealTermsSchema, handoverDeadlineError } from '../../src/shared/validation.js'

export interface DraftRow {
  id: string
  creator_account: string
  creator_role: 'buyer' | 'seller'
  creator_wallet: string
  counterparty_account: string | null
  counterparty_wallet: string | null
  status: string
  create_tx_hash: string | null
  created_at: number
  updated_at: number
}

export interface VersionRow {
  id: string
  draft_id: string
  version: number
  proposed_by: string
  terms_json: string
  salt: string
  agreement_nonce: string
  sign_deadline: number
  agreement_hash: string | null
  buyer_sig: string | null
  buyer_signed_at: number | null
  seller_sig: string | null
  seller_signed_at: number | null
  status: 'open' | 'superseded' | 'executed'
  created_at: number
}

export function buyerWalletOf(d: DraftRow): string | null {
  return d.creator_role === 'buyer' ? d.creator_wallet : d.counterparty_wallet
}

export function sellerWalletOf(d: DraftRow): string | null {
  return d.creator_role === 'seller' ? d.creator_wallet : d.counterparty_wallet
}

/** Loads a draft only for its two parties. Everything else is the same 404. */
export async function memberDraft(ctx: Ctx, id: string): Promise<{ draft: DraftRow; accountId: string }> {
  const accountId = ctx.session?.accountId
  if (!accountId) throw new HttpError(401, 'unauthenticated', 'Sign in required')
  const draft = await dbGet<DraftRow>('SELECT * FROM drafts WHERE id = ?', id)
  if (!draft || (draft.creator_account !== accountId && draft.counterparty_account !== accountId)) throw notFound()
  return { draft, accountId }
}

export function parseTerms(json: string): DealTerms {
  return JSON.parse(json) as DealTerms
}

export function validateTerms(input: unknown): DealTerms {
  const parsed = dealTermsSchema.safeParse(input)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  if (handoverDeadlineError(parsed.data.handoverDeadline, nowSec())) {
    throw new HttpError(400, 'handover_deadline_too_soon', 'Handover deadline must be at least 25 hours from now')
  }
  // Never store an empty list: agreements without attachments must hash exactly as before.
  if (parsed.data.attachments && parsed.data.attachments.length === 0) delete parsed.data.attachments
  return parsed.data
}

/** Computes the agreement hash once both wallets are known. */
export function hashFor(draft: DraftRow, v: Pick<VersionRow, 'terms_json' | 'salt' | 'agreement_nonce'>): Hex | null {
  const buyer = buyerWalletOf(draft)
  const seller = sellerWalletOf(draft)
  if (!buyer || !seller) return null
  return computeAgreementHash({
    terms: parseTerms(v.terms_json),
    wallets: { buyer: getAddress(buyer), seller: getAddress(seller) },
    chainId: env.chainId,
    contract: env.escrow,
    nonce: v.agreement_nonce,
    salt: v.salt as Hex,
  })
}

export async function insertVersion(draft: DraftRow, proposedBy: string, terms: DealTerms): Promise<VersionRow> {
  const last = await dbGet<{ v: number | null }>('SELECT MAX(version) AS v FROM agreement_versions WHERE draft_id = ?', draft.id)
  const salt = `0x${randomHex(32)}`
  // 248-bit nonce keeps it unique per buyer and well inside uint256.
  const nonce = BigInt(`0x${randomHex(31)}`).toString()
  const row = {
    id: newId(),
    draft_id: draft.id,
    version: (last?.v ?? 0) + 1,
    proposed_by: proposedBy,
    terms_json: JSON.stringify(terms),
    salt,
    agreement_nonce: nonce,
    sign_deadline: nowSec() + SIGN_VALIDITY_SECONDS,
  }
  const hash = hashFor(draft, row)
  await dbRun(
    `INSERT INTO agreement_versions
     (id, draft_id, version, proposed_by, terms_json, salt, agreement_nonce, sign_deadline, agreement_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    row.id,
    row.draft_id,
    row.version,
    row.proposed_by,
    row.terms_json,
    row.salt,
    row.agreement_nonce,
    row.sign_deadline,
    hash,
    nowSec(),
  )
  return (await dbGet<VersionRow>('SELECT * FROM agreement_versions WHERE id = ?', row.id))!
}

export function agreementFor(draft: DraftRow, v: VersionRow): AgreementJson | null {
  if (!v.agreement_hash) return null
  const buyer = buyerWalletOf(draft)
  const seller = sellerWalletOf(draft)
  if (!buyer || !seller) return null
  return agreementToJson(
    buildAgreementStruct({
      terms: parseTerms(v.terms_json),
      wallets: { buyer: getAddress(buyer) as Address, seller: getAddress(seller) as Address },
      token: env.usdc,
      agreementHash: v.agreement_hash as Hex,
      agreementNonce: BigInt(v.agreement_nonce),
      signDeadline: v.sign_deadline,
    }),
  )
}

export async function listVersions(draftId: string): Promise<VersionRow[]> {
  return dbAll<VersionRow>('SELECT * FROM agreement_versions WHERE draft_id = ? ORDER BY version ASC', draftId)
}

export async function touchDraft(id: string, status?: string): Promise<void> {
  if (status) await dbRun('UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?', status, nowSec(), id)
  else await dbRun('UPDATE drafts SET updated_at = ? WHERE id = ?', nowSec(), id)
}

export async function escrowForDraft(draft: DraftRow): Promise<{ public_id: string } | null> {
  const versions = (await listVersions(draft.id)).filter((v) => v.agreement_hash)
  for (const v of versions) {
    const row = await dbGet<{ public_id: string }>(
      'SELECT public_id FROM escrows WHERE agreement_hash = ? AND chain_id = ? AND contract = ? AND orphaned = 0',
      v.agreement_hash,
      env.chainId,
      env.escrow,
    )
    if (row) return row
  }
  return null
}

export async function draftView(draft: DraftRow, accountId: string) {
  const versions = await listVersions(draft.id)
  const mine = draft.creator_account === accountId ? draft.creator_role : draft.creator_role === 'buyer' ? 'seller' : 'buyer'
  const isCreator = draft.creator_account === accountId
  const invitation = isCreator
    ? await dbGet<{ id: string; expires_at: number; revoked: number; claimed: number }>(
        `SELECT id, expires_at, revoked, claimed_by IS NOT NULL AS claimed FROM invitations
         WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1`,
        draft.id,
      )
    : null
  const escrow = await escrowForDraft(draft)
  const latest = versions[versions.length - 1]
  const missing = latest ? await missingAttachments(draft.id, parseTerms(latest.terms_json)) : []
  return {
    id: draft.id,
    /** Hashes of files the latest version references but whose bytes are not uploaded yet. Signing is blocked until empty. */
    missingAttachments: missing.map((m) => m.sha256),
    status: escrow ? 'escrow_created' : draft.status,
    myRole: mine,
    creatorRole: draft.creator_role,
    isCreator,
    buyerWallet: buyerWalletOf(draft),
    sellerWallet: sellerWalletOf(draft),
    claimed: Boolean(draft.counterparty_account),
    createTxHash: draft.create_tx_hash,
    publicId: escrow?.public_id ?? null,
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
    invitation: invitation
      ? {
          id: invitation.id,
          expiresAt: invitation.expires_at,
          revoked: Boolean(invitation.revoked),
          claimed: Boolean(invitation.claimed),
          expired: invitation.expires_at < nowSec(),
        }
      : null,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      proposedByMe: v.proposed_by === accountId,
      terms: parseTerms(v.terms_json),
      status: v.status,
      agreementHash: v.agreement_hash,
      signDeadline: v.sign_deadline,
      agreement: agreementFor(draft, v),
      buyerSigned: Boolean(v.buyer_sig),
      sellerSigned: Boolean(v.seller_sig),
      buyerSig: v.buyer_sig,
      sellerSig: v.seller_sig,
      createdAt: v.created_at,
    })),
  }
}
