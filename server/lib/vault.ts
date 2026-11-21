/**
 * Private file vault for evidence and description files.
 *
 * - Every object is encrypted with AES-256-GCM, one random IV each, bound to its owner and hash as authenticated data.
 *   The key is EVIDENCE_ENCRYPTION_KEY (32 bytes of hex). When it is not set the key is derived from PHONE_ENCRYPTION_KEY,
 *   so an existing deployment keeps working; set a dedicated key to rotate them independently.
 * - Downloads need a link signed for the signed-in account that expires after 300 seconds.
 * - Uploads, refused uploads, link issues and downloads are written to an append-only log.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { dbGet, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import { HttpError, requireSession, type Ctx } from '../http.js'
import { bytesFromDb } from './evidenceFile.js'
import { scanFile, SCANNER, type ScanResult } from './scan.js'
import type { AllowedMime } from '../../src/shared/files.js'

export const LINK_TTL_SECONDS = 300

export type VaultScope = 'evidence' | 'draft'

function derive(info: string, root: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), info, 32))
}

const encKey: Buffer = (() => {
  const hex = process.env.EVIDENCE_ENCRYPTION_KEY
  if (hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('EVIDENCE_ENCRYPTION_KEY must be 32 bytes of hex.')
    return Buffer.from(hex, 'hex')
  }
  return derive('sure2p-evidence-v1', env.phoneKey)
})()

const linkKey: Buffer = derive('sure2p-file-link-v1', Buffer.from(env.sessionSecret))

const aad = (scope: VaultScope, ownerRef: string, id: string, sha256: string) => Buffer.from(`${scope}:${ownerRef}:${id}:${sha256}`)

interface VaultRow {
  iv: unknown
  tag: unknown
  ciphertext: unknown
}

export async function vaultPut(o: {
  id: string
  scope: VaultScope
  ownerRef: string
  sha256: string
  bytes: Uint8Array
  scan: ScanResult
}): Promise<void> {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encKey, iv)
  cipher.setAAD(aad(o.scope, o.ownerRef, o.id, o.sha256))
  const ciphertext = Buffer.concat([cipher.update(o.bytes), cipher.final()])
  await dbRun(
    `INSERT INTO vault_objects (id, scope, owner_ref, sha256, size, iv, tag, ciphertext, scan_verdict, scan_reasons, scanner, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    o.id,
    o.scope,
    o.ownerRef,
    o.sha256,
    o.bytes.length,
    new Uint8Array(iv),
    new Uint8Array(cipher.getAuthTag()),
    new Uint8Array(ciphertext),
    o.scan.verdict === 'block' ? 'warn' : o.scan.verdict,
    JSON.stringify(o.scan.reasons),
    o.scan.scanner,
    nowSec(),
  )
}

async function vaultGet(scope: VaultScope, ownerRef: string, id: string, sha256: string): Promise<Uint8Array | null> {
  const r = await dbGet<VaultRow>('SELECT iv, tag, ciphertext FROM vault_objects WHERE id = ? AND scope = ?', id, scope)
  if (!r) return null
  const d = createDecipheriv('aes-256-gcm', encKey, Buffer.from(bytesFromDb(r.iv)))
  d.setAAD(aad(scope, ownerRef, id, sha256))
  d.setAuthTag(Buffer.from(bytesFromDb(r.tag)))
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(bytesFromDb(r.ciphertext))), d.final()]))
}

/**
 * Reads a stored file. New files come from the vault. Files uploaded before the vault existed sit in the table's own
 * content column; they are moved into the vault the first time they are read.
 */
export async function readStoredFile(o: {
  table: 'evidence' | 'draft_files'
  scope: VaultScope
  id: string
  ownerRef: string
  sha256: string
  mime: AllowedMime
}): Promise<Uint8Array | null> {
  const fromVault = await vaultGet(o.scope, o.ownerRef, o.id, o.sha256)
  if (fromVault) return fromVault
  const legacy = await dbGet<{ content: unknown }>(`SELECT content FROM ${o.table} WHERE id = ?`, o.id)
  if (!legacy) return null
  const bytes = bytesFromDb(legacy.content)
  if (bytes.length === 0) return null
  const scan = scanFile(bytes, o.mime)
  const note = scan.verdict === 'block' ? { ...scan, reasons: [...scan.reasons, 'Tệp có từ trước khi bật kiểm tra'] } : scan
  await vaultPut({ id: o.id, scope: o.scope, ownerRef: o.ownerRef, sha256: o.sha256, bytes, scan: note })
  await dbRun(`UPDATE ${o.table} SET content = ? WHERE id = ?`, new Uint8Array(0), o.id)
  return bytes
}

export async function scanInfo(id: string): Promise<{ verdict: 'clean' | 'warn'; reasons: string[]; scanner: string } | null> {
  const r = await dbGet<{ scan_verdict: 'clean' | 'warn'; scan_reasons: string; scanner: string }>(
    'SELECT scan_verdict, scan_reasons, scanner FROM vault_objects WHERE id = ?',
    id,
  )
  return r ? { verdict: r.scan_verdict, reasons: JSON.parse(r.scan_reasons) as string[], scanner: r.scanner } : null
}

export async function logFile(account: string | null, scope: string, ownerRef: string, fileRef: string | null, action: string, detail?: unknown): Promise<void> {
  await dbRun(
    'INSERT INTO file_log (at, account_id, scope, owner_ref, file_ref, action, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nowSec(),
    account,
    scope,
    ownerRef,
    fileRef,
    action,
    detail === undefined ? null : JSON.stringify(detail).slice(0, 500),
  )
}

/** Scans an upload. A blocked file is logged and refused with the reasons; nothing is stored. */
export async function scanOrReject(o: { bytes: Uint8Array; mime: AllowedMime; account: string; scope: string; ownerRef: string }): Promise<ScanResult> {
  const scan = scanFile(o.bytes, o.mime)
  if (scan.verdict === 'block') {
    await logFile(o.account, o.scope, o.ownerRef, null, 'upload_rejected', { reasons: scan.reasons, scanner: SCANNER })
    throw new HttpError(422, 'file_blocked', `File refused by the safety check: ${scan.reasons.join('; ')}`)
  }
  return scan
}

const sign = (kind: string, ownerRef: string, fileKey: string, account: string, exp: number) =>
  createHmac('sha256', linkKey).update(`${kind}|${ownerRef}|${fileKey}|${account}|${exp}`).digest('hex')

/**
 * Two-step download. `?link=1` (signed in, permission already checked by the caller) returns `{ exp, sig }` valid for
 * 300 seconds and for this account only. The file itself is only served with a matching `exp` and `sig`.
 */
export async function serveProtected(
  ctx: Ctx,
  o: { kind: string; ownerRef: string; fileKey: string; load: () => Promise<Response | null> },
): Promise<Response | { exp: number; sig: string; ttl: number }> {
  const account = requireSession(ctx).accountId
  const q = ctx.url.searchParams
  const sig = q.get('sig')
  const exp = Number(q.get('exp') ?? 0)
  if (sig && exp) {
    const expected = sign(o.kind, o.ownerRef, o.fileKey, account, exp)
    const ok = exp > nowSec() && sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    if (!ok) throw new HttpError(403, 'link_invalid', 'This download link has expired. Open the file again.')
    const res = await o.load()
    if (!res) throw new HttpError(404, 'not_found', 'Not found')
    await logFile(account, o.kind, o.ownerRef, o.fileKey, 'download')
    return res
  }
  if (q.get('link') === '1') {
    const e = nowSec() + LINK_TTL_SECONDS
    await logFile(account, o.kind, o.ownerRef, o.fileKey, 'link_issued')
    return { exp: e, sig: sign(o.kind, o.ownerRef, o.fileKey, account, e), ttl: LINK_TTL_SECONDS }
  }
  throw new HttpError(403, 'link_required', 'Request a download link first')
}
