import { getAddress, isAddressEqual } from 'viem'
import { audit, dbGet, dbRun, dbTx, nowSec } from '../db.js'
import { HttpError, notFound, rateLimit, requireNewTradeEligible, requireWallet, route, type Ctx } from '../http.js'
import { hmac, newId, normalizeInviteCode, randomInviteCode, randomToken } from '../lib/crypto.js'
import { hashFor, listVersions, memberDraft, parseTerms, touchDraft, type DraftRow } from '../lib/deals.js'
import { inviteLookupSchema } from '../../src/shared/validation.js'

const INVITE_TTL = 24 * 60 * 60

interface InviteRow {
  id: string
  draft_id: string
  created_by: string
  expires_at: number
  revoked: number
  claimed_by: string | null
}

async function findInvite(input: { token?: string; code?: string }): Promise<InviteRow | null> {
  if (input.token) {
    return dbGet<InviteRow>(
      'SELECT id, draft_id, created_by, expires_at, revoked, claimed_by FROM invitations WHERE token_hash = ?',
      hmac('invite-token', input.token),
    )
  }
  if (input.code) {
    return dbGet<InviteRow>(
      'SELECT id, draft_id, created_by, expires_at, revoked, claimed_by FROM invitations WHERE code_hash = ?',
      hmac('invite-code', normalizeInviteCode(input.code)),
    )
  }
  return null
}

/** Usable invites only; every failure is the same 404 so nothing leaks to guessers. */
async function usableInvite(ctx: Ctx, input: { token?: string; code?: string }): Promise<InviteRow> {
  const s = requireWallet(ctx)
  rateLimit(`invite-lookup:acct:${s.accountId}`, 15, 10 * 60)
  rateLimit(`invite-lookup:ip:${ctx.ip}`, 60, 10 * 60)
  if (!input.token && !input.code) throw notFound()
  const invite = await findInvite(input)
  if (!invite || invite.revoked || invite.claimed_by || invite.expires_at < nowSec()) throw notFound()
  if (invite.created_by === s.accountId) throw notFound()
  return invite
}

route('POST', '/drafts/:id/invitations', async (ctx) => {
  const s = requireWallet(ctx)
  requireNewTradeEligible(s)
  const { draft, accountId } = await memberDraft(ctx, ctx.params.id)
  if (draft.creator_account !== accountId) throw notFound()
  if (draft.counterparty_account) throw new HttpError(409, 'already_claimed', 'A counterparty already joined')
  rateLimit(`invite-issue:${accountId}`, 10, 60 * 60)

  const token = randomToken(32)
  const code = randomInviteCode()
  const id = newId()
  await dbTx(async () => {
    // Re-issuing invalidates every earlier unclaimed invitation for this draft.
    await dbRun('UPDATE invitations SET revoked = 1 WHERE draft_id = ? AND claimed_by IS NULL', draft.id)
    await dbRun(
      `INSERT INTO invitations (id, draft_id, token_hash, code_hash, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      draft.id,
      hmac('invite-token', token),
      hmac('invite-code', normalizeInviteCode(code)),
      accountId,
      nowSec() + INVITE_TTL,
      nowSec(),
    )
    await touchDraft(draft.id, 'invited')
  })
  await audit(accountId, 'invite.issued', draft.id, { invitationId: id })
  // Plaintext secrets are returned exactly once and are never stored.
  return { invitationId: id, token, code, expiresAt: nowSec() + INVITE_TTL }
})

async function revokeInvitation(ctx: Ctx): Promise<{ ok: boolean }> {
  requireWallet(ctx)
  const accountId = ctx.session!.accountId
  const res = await dbRun('UPDATE invitations SET revoked = 1 WHERE id = ? AND created_by = ? AND claimed_by IS NULL', ctx.params.id, accountId)
  if (res.changes !== 1) throw notFound()
  await audit(accountId, 'invite.revoked', ctx.params.id)
  return { ok: true }
}

route('POST', '/invitations/:id/revoke', revokeInvitation)

/** Limited pre-claim metadata. Requires phone + wallet authentication. */
route('POST', '/invitations/peek', async (ctx) => {
  const input = await ctx.body(inviteLookupSchema)
  const invite = await usableInvite(ctx, input)
  const draft = (await dbGet<DraftRow>('SELECT * FROM drafts WHERE id = ?', invite.draft_id))!
  const latest = (await listVersions(draft.id)).filter((v) => v.status === 'open').pop()
  if (!latest) throw notFound()
  const terms = parseTerms(latest.terms_json)
  return {
    inviterRole: draft.creator_role,
    yourRole: draft.creator_role === 'buyer' ? 'seller' : 'buyer',
    title: terms.title,
    priceUnits: terms.priceUnits,
    expiresAt: invite.expires_at,
  }
})

route('POST', '/invitations/claim', async (ctx) => {
  const s = requireWallet(ctx)
  requireNewTradeEligible(s)
  const input = await ctx.body(inviteLookupSchema)
  const invite = await usableInvite(ctx, input)
  const wallet = getAddress(s.wallet)

  const result = await dbTx(async () => {
    const draft = (await dbGet<DraftRow>('SELECT * FROM drafts WHERE id = ?', invite.draft_id))!
    if (isAddressEqual(wallet, getAddress(draft.creator_wallet))) return null
    // Atomic, race-safe single claim: only one concurrent caller sees changes === 1.
    const claimed = await dbRun(
      `UPDATE invitations SET claimed_by = ?, claimed_at = ?
       WHERE id = ? AND claimed_by IS NULL AND revoked = 0 AND expires_at > ?`,
      s.accountId,
      nowSec(),
      invite.id,
      nowSec(),
    )
    if (claimed.changes !== 1) return null
    const bound = await dbRun(
      `UPDATE drafts SET counterparty_account = ?, counterparty_wallet = ?, status = 'negotiating', updated_at = ?
       WHERE id = ? AND counterparty_account IS NULL`,
      s.accountId,
      wallet,
      nowSec(),
      draft.id,
    )
    if (bound.changes !== 1) throw new Error('draft already bound')
    // Version rows created before a counterparty existed get their hash now (they hold no signatures yet).
    const bounded = (await dbGet<DraftRow>('SELECT * FROM drafts WHERE id = ?', draft.id))!
    for (const v of await listVersions(draft.id)) {
      if (!v.agreement_hash) {
        const h = hashFor(bounded, v)
        if (h) await dbRun('UPDATE agreement_versions SET agreement_hash = ? WHERE id = ?', h, v.id)
      }
    }
    return draft.id
  })

  if (!result) throw notFound()
  await audit(s.accountId, 'invite.claimed', result, { invitationId: invite.id })
  return { draftId: result }
})

/**
 * Flattened alias (2026-11-17): POST /invitations/:id?action=revoke.
 * The old /invitations/:id/revoke path still works on the local dev server;
 * on Vercel it has no function file of its own, so the app calls this shape.
 * Registered last so /invitations/peek and /invitations/claim still match first.
 */
route('POST', '/invitations/:id', async (ctx) => {
  if (ctx.url.searchParams.get('action') === 'revoke') return revokeInvitation(ctx)
  throw notFound()
})
