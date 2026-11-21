import type { AttachmentRef } from '@/shared/protocol'
import { ATTACHMENT_MAX_BYTES, mimeForFilename } from '@/shared/files'
import { api } from './api'

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function toBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

/** The reference that goes into the signed terms for a chosen file. Null when the type or size is not accepted. */
export async function refForFile(file: File): Promise<AttachmentRef | null> {
  const mime = mimeForFilename(file.name)
  if (!mime || file.size === 0 || file.size > ATTACHMENT_MAX_BYTES) return null
  return { name: file.name.slice(0, 120), mime, size: file.size, sha256: await sha256Hex(file) }
}

/** Sends the bytes of a description file to a draft. The server checks type and content again. */
export async function uploadAttachment(draftId: string, file: File): Promise<void> {
  await api(`/drafts/${draftId}?action=attach`, { body: { filename: file.name, dataBase64: await toBase64(file) } })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Private files are served only with a link signed for the signed-in account that expires after 300 seconds.
 * Ask for a fresh link, then download the file with it.
 */
export async function openProtectedFile(href: string, filename: string): Promise<void> {
  const path = href.replace(/^\/api/, '')
  const { exp, sig } = await api<{ exp: number; sig: string }>(`${path}${path.includes('?') ? '&' : '?'}link=1`)
  const a = document.createElement('a')
  a.href = `${href}${href.includes('?') ? '&' : '?'}exp=${exp}&sig=${sig}`
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
