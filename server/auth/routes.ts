import { randomInt } from 'node:crypto'
import { getAddress, isAddressEqual, recoverMessageAddress, type Hex } from 'viem'
import { createSiweMessage, parseSiweMessage } from 'viem/siwe'
import { audit, dbGet, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import { encryptPhone, hmac, newId, randomHex, safeEqual } from '../lib/crypto.js'
import {
  HttpError,
  createSession,
  destroySession,
  rateLimit,
  requireSession,
  route,
  type Ctx,
} from '../http.js'
import {
  otpRequestSchema,
  otpVerifySchema,
  walletChallengeSchema,
  walletVerifySchema,
} from '../../src/shared/validation.js'

const OTP_TTL = 5 * 60
const MAX_OTP_ATTEMPTS = 5
const NONCE_TTL = 5 * 60

function requestHost(ctx: Ctx): string {
  return ctx.req.headers.get('x-forwarded-host') ?? ctx.req.headers.get('host') ?? ctx.url.host
}

function meResponse(ctx: Ctx) {
  const s = ctx.session
  if (!s) return { authenticated: false, otpProvider: env.otpProvider }
  return {
    authenticated: true,
    accountId: s.accountId,
    accountStatus: s.accountStatus,
    wallet: s.wallet,
    chainId: s.chainId,
    otpProvider: env.otpProvider,
    contracts: { escrow: env.escrow, registry: env.registry, usdc: env.usdc },
  }
}

/**
 * MOCK OTP: the code is generated here and returned to the caller so local and
 * testnet flows work without an SMS provider. The server refuses to start with
 * this provider in production unless DEMO_ALLOW_MOCK_OTP=true explicitly opts
 * a labelled demo deploy in (see server/env.ts).
 */
route('POST', '/auth/otp/request', async (ctx) => {
  const { phone } = await ctx.body(otpRequestSchema)
  const phoneHmac = hmac('phone', phone)
  rateLimit(`otp-req:phone:${phoneHmac}`, 3, 10 * 60)
  rateLimit(`otp-req:ip:${ctx.ip}`, 20, 60 * 60)
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const id = newId()
  await dbRun(
    'INSERT INTO otp_challenges (id, phone_hmac, code_hash, attempts, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?, 0, ?)',
    id,
    phoneHmac,
    hmac('otp', `${id}:${code}`),
    nowSec() + OTP_TTL,
    nowSec(),
  )
  console.log(`[MOCK OTP] code issued for a phone number (dev only): ${code}`)
  // Same response whether or not an account exists for this number.
  return { sent: true, provider: 'mock', mockCode: code, expiresInSeconds: OTP_TTL }
})

route('POST', '/auth/otp/verify', async (ctx) => {
  const { phone, code } = await ctx.body(otpVerifySchema)
  const phoneHmac = hmac('phone', phone)
  rateLimit(`otp-verify:phone:${phoneHmac}`, 10, 10 * 60)
  rateLimit(`otp-verify:ip:${ctx.ip}`, 40, 60 * 60)

  const challenge = await dbGet<{ id: string; code_hash: string; attempts: number }>(
    'SELECT id, code_hash, attempts FROM otp_challenges WHERE phone_hmac = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    phoneHmac,
    nowSec(),
  )
  if (!challenge || challenge.attempts >= MAX_OTP_ATTEMPTS) {
    throw new HttpError(400, 'invalid_code', 'Invalid or expired code')
  }
  if (!safeEqual(challenge.code_hash, hmac('otp', `${challenge.id}:${code}`))) {
    await dbRun('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?', challenge.id)
    throw new HttpError(400, 'invalid_code', 'Invalid or expired code')
  }
  // One-use: the conditional update makes concurrent verifications race-safe.
  const used = await dbRun('UPDATE otp_challenges SET used = 1 WHERE id = ? AND used = 0', challenge.id)
  if (used.changes !== 1) throw new HttpError(400, 'invalid_code', 'Invalid or expired code')

  let account = await dbGet<{ id: string; status: string }>('SELECT id, status FROM accounts WHERE phone_hmac = ?', phoneHmac)
  if (!account) {
    const id = newId()
    await dbRun(
      'INSERT INTO accounts (id, phone_hmac, phone_enc, status, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      phoneHmac,
      encryptPhone(phone),
      'active',
      nowSec(),
    )
    account = { id, status: 'active' }
    await audit(id, 'account.created')
  }
  // A new login always replaces any earlier session in this browser.
  await destroySession(ctx)
  await createSession(ctx, account.id)
  await audit(account.id, 'auth.login')
  ctx.session = null
  return { verified: true }
})

route('POST', '/auth/wallet/challenge', async (ctx) => {
  const s = requireSession(ctx)
  const { address } = await ctx.body(walletChallengeSchema)
  rateLimit(`wallet-challenge:${s.accountId}`, 10, 10 * 60)
  const checksummed = getAddress(address)
  const nonce = randomHex(16)
  const now = new Date()
  const message = createSiweMessage({
    address: checksummed,
    chainId: env.chainId,
    domain: requestHost(ctx),
    nonce,
    uri: `https://${requestHost(ctx)}`,
    version: '1',
    statement: 'Sign in to sure2p and link this wallet to your account. This does not move funds.',
    issuedAt: now,
    expirationTime: new Date(now.getTime() + NONCE_TTL * 1000),
  })
  await dbRun(
    'INSERT INTO wallet_nonces (nonce, session_hash, address, message, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)',
    nonce,
    s.sidHash,
    checksummed,
    message,
    nowSec() + NONCE_TTL,
  )
  return { message, nonce }
})

route('POST', '/auth/wallet/verify', async (ctx) => {
  const s = requireSession(ctx)
  const { message, signature } = await ctx.body(walletVerifySchema)
  rateLimit(`wallet-verify:${s.accountId}`, 10, 10 * 60)

  const parsed = parseSiweMessage(message)
  if (!parsed.nonce || !parsed.address) throw new HttpError(400, 'invalid_message', 'Invalid sign-in message')
  const row = await dbGet<{ session_hash: string; address: string; message: string; expires_at: number; used: number }>(
    'SELECT session_hash, address, message, expires_at, used FROM wallet_nonces WHERE nonce = ?',
    parsed.nonce,
  )
  if (!row || row.used || row.expires_at < nowSec() || row.session_hash !== s.sidHash || row.message !== message) {
    throw new HttpError(400, 'invalid_challenge', 'Challenge expired or invalid')
  }
  if (parsed.chainId !== env.chainId) throw new HttpError(400, 'wrong_chain', 'Wrong chain in sign-in message')
  const claimed = await dbRun('UPDATE wallet_nonces SET used = 1 WHERE nonce = ? AND used = 0', parsed.nonce)
  if (claimed.changes !== 1) throw new HttpError(400, 'invalid_challenge', 'Challenge expired or invalid')

  const recovered = await recoverMessageAddress({ message, signature: signature as Hex })
  if (!isAddressEqual(recovered, getAddress(row.address))) {
    throw new HttpError(400, 'bad_signature', 'Signature does not match the wallet')
  }

  const address = getAddress(row.address)
  const existing = await dbGet<{ account_id: string }>('SELECT account_id FROM wallet_links WHERE address = ?', address)
  if (existing && existing.account_id !== s.accountId) {
    throw new HttpError(409, 'wallet_in_use', 'This wallet is linked to another account')
  }
  if (!existing) {
    await dbRun(
      'INSERT INTO wallet_links (address, account_id, proof_message, proof_signature, chain_id, linked_at) VALUES (?, ?, ?, ?, ?, ?)',
      address,
      s.accountId,
      message,
      signature,
      env.chainId,
      nowSec(),
    )
  }
  await dbRun('UPDATE sessions SET wallet = ?, chain_id = ? WHERE id_hash = ?', address, env.chainId, s.sidHash)
  await audit(s.accountId, 'wallet.linked', address)
  ctx.session = { ...s, wallet: address, chainId: env.chainId }
  return meResponse(ctx)
})

route('POST', '/auth/logout', async (ctx) => {
  await destroySession(ctx)
  return { ok: true }
})

route('GET', '/me', (ctx) => meResponse(ctx))
