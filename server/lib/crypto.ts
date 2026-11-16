import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

/** Keyed hash for secrets stored at rest (session ids, invite tokens, OTP codes, phone index). */
export function hmac(label: string, value: string): string {
  return createHmac('sha256', env.sessionSecret).update(label).update('\0').update(value).digest('hex')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** AES-256-GCM encryption for phone numbers. Output: base64url(iv | tag | ciphertext). */
export function encryptPhone(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', env.phoneKey, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url')
}

export function decryptPhone(blob: string): string {
  const raw = Buffer.from(blob, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', env.phoneKey, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}

export { generatePublicId, newDraftRef, normalizeInviteCode, randomInviteCode } from './ids.js'

export function newId(): string {
  return randomBytes(12).toString('hex')
}
