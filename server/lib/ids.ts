import { randomBytes } from 'node:crypto'

/** Pure identifier helpers with no environment dependency, so they are unit-testable. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 16 Crockford base32 characters (80 bits), formatted XXXX-XXXX-XXXX-XXXX. */
export function randomInviteCode(): string {
  const bytes = randomBytes(16)
  let out = ''
  for (let i = 0; i < 16; i++) out += CROCKFORD[bytes[i] % 32]
  return out.match(/.{4}/g)!.join('-')
}

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

/** Opaque, unguessable pre-chain draft reference. */
export function newDraftRef(): string {
  return `d${randomBytes(10).toString('hex')}`
}

/** 12 lowercase hex characters that contain at least one a-f. */
export function generatePublicId(): string {
  for (;;) {
    const id = randomBytes(6).toString('hex')
    if (/[a-f]/.test(id)) return id
  }
}
