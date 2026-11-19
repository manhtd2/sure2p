import { ALLOWED_MIME, type AllowedMime } from '../../src/shared/files.js'

export { ALLOWED_MIME, type AllowedMime }

const OLE_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** The bytes must match the declared type, so a script cannot be smuggled in as a document or image. */
export function matchesMime(bytes: Uint8Array, mime: AllowedMime): boolean {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b)
  switch (mime) {
    case 'image/png':
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return startsWith([0xff, 0xd8, 0xff])
    case 'image/webp':
      return startsWith([0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    case 'application/pdf':
      return startsWith([0x25, 0x50, 0x44, 0x46])
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      // OOXML files are zip containers.
      return startsWith([0x50, 0x4b, 0x03, 0x04])
    case 'application/vnd.ms-excel':
    case 'application/msword':
      // Legacy Office files are OLE containers. (A .xls saved as plain CSV is also sent with this type by some systems; reject it.)
      return startsWith(OLE_HEADER)
    case 'text/plain':
    case 'text/csv':
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        return !bytes.includes(0)
      } catch {
        return false
      }
  }
}

/** Drivers return a Uint8Array (local file DB) or an ArrayBuffer (libSQL). */
export function bytesFromDb(content: unknown): Uint8Array {
  return content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer)
}

/** A download response: always an attachment, never rendered by the browser, never sniffed. */
export function fileResponse(bytes: Uint8Array, mime: string, filename: string): Response {
  return new Response(new Blob([bytes as BlobPart], { type: mime }), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
