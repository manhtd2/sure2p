/**
 * File types accepted for deal description attachments and dispute evidence.
 * The type is decided by the file extension and then checked against the file's real bytes on the server.
 * Macro-enabled Office formats (xlsm, docm) are deliberately not accepted.
 */
export const FILE_TYPES = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const

export type FileExtension = keyof typeof FILE_TYPES
export type AllowedMime = (typeof FILE_TYPES)[FileExtension]

export const ALLOWED_MIME = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const satisfies readonly AllowedMime[]

/** Value for an <input type="file" accept="..."> attribute. */
export const FILE_ACCEPT = Object.keys(FILE_TYPES)
  .map((ext) => `.${ext}`)
  .join(',')

/** Description attachments: kept small because the upload goes through a 4.5 MB serverless request. */
export const ATTACHMENT_MAX_BYTES = 3_000_000
export const ATTACHMENT_MAX_FILES = 5

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i < 0 ? '' : filename.slice(i + 1).toLowerCase()
}

/** The MIME type for a file name, or null when the extension is not accepted. */
export function mimeForFilename(filename: string): AllowedMime | null {
  const ext = extensionOf(filename)
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, ext) ? FILE_TYPES[ext as FileExtension] : null
}
