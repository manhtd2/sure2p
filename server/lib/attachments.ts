/** Description files the Buyer attaches to a deal. Content is stored per draft, addressed by sha256. */
import { dbAll, dbGet } from '../db.js'
import { type AttachmentRef, type DealTerms } from '../../src/shared/protocol.js'
import { ATTACHMENT_MAX_BYTES } from '../../src/shared/files.js'
import { fileResponse } from './evidenceFile.js'
import { readStoredFile } from './vault.js'
import type { AllowedMime } from '../../src/shared/files.js'

export const MAX_ATTACH_BODY = Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 4096
/** Uploaded files per draft, including ones dropped by a later version. Bounds storage. */
export const MAX_DRAFT_FILES = 10

export function attachmentsOf(terms: Pick<DealTerms, 'attachments'>): AttachmentRef[] {
  return terms.attachments ?? []
}

/** Which of these hashes already have their bytes stored for the draft. */
export async function presentHashes(draftId: string, refs: AttachmentRef[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set()
  const rows = await dbAll<{ sha256: string; size: number }>('SELECT sha256, size FROM draft_files WHERE draft_id = ?', draftId)
  const bySha = new Map(rows.map((r) => [r.sha256, r.size]))
  return new Set(refs.filter((r) => bySha.get(r.sha256) === r.size).map((r) => r.sha256))
}

/** Every referenced file must have its bytes before a version can be signed. */
export async function missingAttachments(draftId: string, terms: DealTerms): Promise<AttachmentRef[]> {
  const refs = attachmentsOf(terms)
  const present = await presentHashes(draftId, refs)
  return refs.filter((r) => !present.has(r.sha256))
}

export async function draftFileResponse(draftId: string, sha256: string): Promise<Response | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null
  const f = await dbGet<{ id: string; filename: string; mime: string }>(
    'SELECT id, filename, mime FROM draft_files WHERE draft_id = ? AND sha256 = ?',
    draftId,
    sha256,
  )
  if (!f) return null
  const bytes = await readStoredFile({ table: 'draft_files', scope: 'draft', id: f.id, ownerRef: draftId, sha256, mime: f.mime as AllowedMime })
  return bytes ? fileResponse(bytes, f.mime, f.filename) : null
}

/** A file referenced by the signed agreement of this escrow. Only hashes in that agreement can be fetched. */
export async function escrowAttachmentResponse(agreementHash: string, sha256: string): Promise<Response | null> {
  const v = await dbGet<{ draft_id: string; terms_json: string }>(
    'SELECT draft_id, terms_json FROM agreement_versions WHERE agreement_hash = ?',
    agreementHash,
  )
  if (!v) return null
  const terms = JSON.parse(v.terms_json) as DealTerms
  if (!attachmentsOf(terms).some((a) => a.sha256 === sha256)) return null
  return draftFileResponse(v.draft_id, sha256)
}
