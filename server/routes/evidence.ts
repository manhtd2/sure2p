/**
 * Evidence files for open cases. Bytes are stored in the database; their sha256 can be
 * anchored onchain by a party (`anchorEvidence`) so the file cannot be backdated.
 * Visible only to the two parties and to the onchain arbiter and appeal reviewer.
 */
import { createHash } from 'node:crypto'
import { getAddress, keccak256, toBytes } from 'viem'
import { z } from 'zod'
import { dbAll, dbGet, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import { HttpError, notFound, rateLimit, requireSession, route, type Ctx } from '../http.js'
import { randomToken } from '../lib/crypto.js'
import { ALLOWED_MIME, matchesMime } from '../lib/evidenceFile.js'
import { adminRoleOf, anchoredHashes } from '../lib/rulings.js'
import { OPEN_CASE_STAGES, isPublicId } from '../../src/shared/protocol.js'
import { memberEscrow, type EscrowRow } from './transactions.js'

export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024
const MAX_FILES_PER_ESCROW = 25
/** Base64 inflates by 4/3 and the JSON wrapper adds a little. */
const MAX_UPLOAD_BODY = Math.ceil((MAX_EVIDENCE_BYTES * 4) / 3) + 4096

const uploadSchema = z.object({
  filename: z.string().trim().min(1).max(120),
  mime: z.enum(ALLOWED_MIME),
  note: z.string().trim().max(500).optional(),
  dataBase64: z.string().min(1),
})

interface EvidenceRow {
  id: string
  public_id: string
  uploader_wallet: string
  filename: string
  mime: string
  size: number
  sha256: string
  note: string | null
  created_at: number
}

const META_COLUMNS = 'id, public_id, uploader_wallet, filename, mime, size, sha256, note, created_at'

async function loadEscrowRow(publicId: string): Promise<EscrowRow> {
  if (!isPublicId(publicId)) throw notFound()
  const row = await dbGet<EscrowRow>(
    'SELECT * FROM escrows WHERE public_id = ? AND chain_id = ? AND contract = ? AND orphaned = 0',
    publicId,
    env.chainId,
    env.escrow,
  )
  if (!row) throw notFound()
  return row
}

/** A party of the escrow, or the onchain arbiter or appeal reviewer. Everyone else gets a uniform 404. */
async function partyOrAdmin(ctx: Ctx, publicId: string): Promise<{ row: EscrowRow; member: boolean }> {
  try {
    const { row } = await memberEscrow(ctx, publicId)
    return { row, member: true }
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 404) throw err
  }
  const s = requireSession(ctx)
  if (!(await adminRoleOf(s.wallet))) throw notFound()
  return { row: await loadEscrowRow(publicId), member: false }
}

export async function evidenceList(row: EscrowRow) {
  const files = await dbAll<EvidenceRow>(
    `SELECT ${META_COLUMNS} FROM evidence WHERE public_id = ? ORDER BY created_at, id`,
    row.public_id,
  )
  const anchored = await anchoredHashes(row.on_chain_id)
  return files.map((f) => ({
    id: f.id,
    filename: f.filename,
    mime: f.mime,
    size: f.size,
    sha256: `0x${f.sha256}`,
    note: f.note,
    uploadedBy: getAddress(f.uploader_wallet) === getAddress(row.buyer_wallet) ? ('buyer' as const) : ('seller' as const),
    createdAt: f.created_at,
    anchored: anchored.get(`0x${f.sha256}`) ?? null,
  }))
}

route('GET', '/transactions/:publicId/evidence', async (ctx) => {
  const { row } = await partyOrAdmin(ctx, ctx.params.publicId)
  // Flattened alias (2026-11-17): ?evidenceId=<id> downloads one file.
  // The old /evidence/:evidenceId path still works on the local dev server;
  // on Vercel it has no function file of its own, so the app calls this shape.
  const evidenceId = ctx.url.searchParams.get('evidenceId')
  if (evidenceId) return downloadEvidence(ctx, row, evidenceId)
  return { files: await evidenceList(row), maxBytes: MAX_EVIDENCE_BYTES, mimeTypes: ALLOWED_MIME }
})

route('POST', '/transactions/:publicId/evidence', async (ctx) => {
  const { row, wallet } = await memberEscrow(ctx, ctx.params.publicId)
  const account = requireSession(ctx).accountId
  if (!OPEN_CASE_STAGES.includes(row.stage)) {
    throw new HttpError(409, 'case_not_open', 'Evidence can only be added while the case is overdue, disputed or under ruling')
  }
  rateLimit(`evidence:${account}`, 20, 600)
  const body = await ctx.body(uploadSchema, MAX_UPLOAD_BODY)
  const bytes = new Uint8Array(Buffer.from(body.dataBase64, 'base64'))
  if (bytes.length === 0) throw new HttpError(400, 'invalid_input', 'The file is empty')
  if (bytes.length > MAX_EVIDENCE_BYTES) throw new HttpError(413, 'too_large', 'File is larger than 2 MB')
  if (!matchesMime(bytes, body.mime)) throw new HttpError(400, 'invalid_file', 'The file content does not match its type')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const existing = await dbGet<{ id: string }>('SELECT id FROM evidence WHERE public_id = ? AND sha256 = ?', row.public_id, sha256)
  if (existing) return { id: existing.id, sha256: `0x${sha256}`, duplicate: true }
  const count = await dbGet<{ n: number }>('SELECT COUNT(*) AS n FROM evidence WHERE public_id = ?', row.public_id)
  if ((count?.n ?? 0) >= MAX_FILES_PER_ESCROW) throw new HttpError(409, 'too_many_files', 'This case already has the maximum number of files')
  const id = randomToken(12)
  await dbRun(
    `INSERT INTO evidence (id, public_id, uploader_wallet, uploader_account, filename, mime, size, sha256, note, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    row.public_id,
    wallet,
    account,
    body.filename.replace(/[\\/\u0000-\u001f]/g, '_'),
    body.mime,
    bytes.length,
    sha256,
    body.note ?? null,
    bytes,
    nowSec(),
  )
  return { id, sha256: `0x${sha256}`, duplicate: false }
})

async function downloadEvidence(ctx: Ctx, row: EscrowRow, evidenceId: string): Promise<Response> {
  const file = await dbGet<EvidenceRow & { content: unknown }>(
    `SELECT ${META_COLUMNS}, content FROM evidence WHERE id = ? AND public_id = ?`,
    evidenceId,
    row.public_id,
  )
  if (!file) throw notFound()
  // Drivers return a Uint8Array (local) or an ArrayBuffer (libSQL).
  const bytes = file.content instanceof Uint8Array ? file.content : new Uint8Array(file.content as ArrayBuffer)
  return new Response(new Blob([bytes as BlobPart], { type: file.mime }), {
    status: 200,
    headers: {
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}

route('GET', '/transactions/:publicId/evidence/:evidenceId', async (ctx) => {
  const { row } = await partyOrAdmin(ctx, ctx.params.publicId)
  return downloadEvidence(ctx, row, ctx.params.evidenceId)
})

const noteSchema = z.object({ text: z.string().trim().min(3).max(2000) })

/**
 * Stores the plain text behind a hash that a party will send onchain (for example an appeal reason),
 * so the other side and the admins can read what the hash stands for. Returns the hash to send.
 */
export async function saveNote(publicId: string, wallet: string, text: string): Promise<{ hash: string }> {
  const hash = keccak256(toBytes(text))
  await dbRun(
    'INSERT OR IGNORE INTO case_notes (hash, public_id, author_wallet, text, created_at) VALUES (?, ?, ?, ?, ?)',
    hash,
    publicId,
    wallet,
    text,
    nowSec(),
  )
  return { hash }
}

route('POST', '/transactions/:publicId/notes', async (ctx) => {
  const { row, wallet } = await memberEscrow(ctx, ctx.params.publicId)
  rateLimit(`notes:${wallet}`, 20, 600)
  const { text } = await ctx.body(noteSchema)
  return saveNote(row.public_id, wallet, text)
})
