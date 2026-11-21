/**
 * Basic upload checks for evidence and description files.
 *
 * This is NOT antivirus. It refuses the common ways a document is turned into a weapon (macros, embedded
 * executables, PDF scripts, zip bombs, data hidden after an image) by looking at the file structure. It cannot see
 * inside compressed streams, so a malicious file can still pass. Treat every download as untrusted.
 */
import type { AllowedMime } from '../../src/shared/files.js'

export const SCANNER = 'builtin-v1'

export interface ScanResult {
  verdict: 'clean' | 'warn' | 'block'
  reasons: string[]
  scanner: string
}

const EXEC_EXT = /\.(exe|dll|com|scr|bat|cmd|ps1|vbs|vbe|js|jse|wsf|jar|msi|lnk|hta|cpl|reg|sh|app|dmg|apk)$/i
const MAX_ZIP_ENTRIES = 1000
const MAX_ZIP_UNCOMPRESSED = 100 * 1024 * 1024
const MAX_ENTRY_RATIO = 200

const latin1 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1')

interface ZipEntry {
  name: string
  compressed: number
  uncompressed: number
}

/** Reads only the zip central directory. Returns null when the structure is not a valid zip. */
function listZip(b: Uint8Array): ZipEntry[] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)
  if (count > MAX_ZIP_ENTRIES * 4) return null
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (off + 46 > b.length || dv.getUint32(off, true) !== 0x02014b50) return null
    const compressed = dv.getUint32(off + 20, true)
    const uncompressed = dv.getUint32(off + 24, true)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    if (off + 46 + nameLen > b.length) return null
    entries.push({ name: Buffer.from(b.subarray(off + 46, off + 46 + nameLen)).toString('utf8'), compressed, uncompressed })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function scanZip(b: Uint8Array, reasons: string[]): void {
  const entries = listZip(b)
  if (!entries) {
    reasons.push('Cấu trúc tệp nén không hợp lệ')
    return
  }
  if (entries.length > MAX_ZIP_ENTRIES) reasons.push(`Quá nhiều thành phần trong tệp (${entries.length})`)
  const total = entries.reduce((sum, e) => sum + e.uncompressed, 0)
  if (total > MAX_ZIP_UNCOMPRESSED) reasons.push('Dung lượng sau khi giải nén quá lớn (nghi tệp nén bom)')
  for (const e of entries) {
    const lower = e.name.toLowerCase()
    if (e.name.includes('..') || e.name.startsWith('/')) reasons.push(`Đường dẫn bất thường trong tệp: ${e.name.slice(0, 60)}`)
    if (e.uncompressed > 1024 * 1024 && e.compressed > 0 && e.uncompressed / e.compressed > MAX_ENTRY_RATIO) {
      reasons.push('Tỉ lệ nén bất thường (nghi tệp nén bom)')
    }
    if (lower.endsWith('vbaproject.bin') || lower.includes('vbadata')) reasons.push('Chứa macro VBA')
    else if (lower.includes('/activex/')) reasons.push('Chứa điều khiển ActiveX')
    else if (lower.includes('/embeddings/')) reasons.push('Chứa đối tượng nhúng')
    else if (EXEC_EXT.test(lower)) reasons.push(`Chứa tệp thực thi hoặc script: ${e.name.slice(0, 60)}`)
  }
}

function scanOle(b: Uint8Array, reasons: string[]): void {
  const s = latin1(b)
  // Names inside an OLE file are stored as UTF-16, so the letters are separated by NUL bytes.
  if (s.includes('V\0B\0A\0') || s.includes('_\0V\0B\0A\0_\0P\0R\0O\0J\0E\0C\0T') || s.includes('M\0a\0c\0r\0o\0s\0')) {
    reasons.push('Chứa macro VBA (có thể báo nhầm nếu nội dung có chữ "VBA"; hãy lưu lại dạng xlsx hoặc docx)')
  }
}

function scanPdf(b: Uint8Array, reasons: string[]): void {
  // PDF names may hide letters as #hh, so decode before searching.
  const s = latin1(b).replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
  for (const [re, label] of [
    [/\/(JavaScript|JS)\b/, 'Chứa JavaScript'],
    [/\/Launch\b/, 'Có lệnh mở chương trình (Launch)'],
    [/\/EmbeddedFile\b/, 'Chứa tệp nhúng'],
    [/\/RichMedia\b/, 'Chứa nội dung đa phương tiện chủ động'],
    [/\/XFA\b/, 'Chứa biểu mẫu XFA'],
  ] as const) {
    if (re.test(s)) reasons.push(label)
  }
}

function scanImage(b: Uint8Array, mime: AllowedMime, reasons: string[]): void {
  let trailing = 0
  if (mime === 'image/png') {
    const iend = latin1(b).lastIndexOf('IEND')
    trailing = iend < 0 ? Number.POSITIVE_INFINITY : b.length - (iend + 8)
  } else if (mime === 'image/jpeg') {
    let end = -1
    for (let i = b.length - 2; i >= 0; i--) {
      if (b[i] === 0xff && b[i + 1] === 0xd9) {
        end = i + 2
        break
      }
    }
    trailing = end < 0 ? Number.POSITIVE_INFINITY : b.length - end
  } else if (mime === 'image/webp') {
    const declared = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true) + 8
    trailing = b.length - declared
  }
  if (trailing > (mime === 'image/jpeg' ? 1024 : 64)) reasons.push('Có dữ liệu thừa sau phần ảnh')
}

function scanText(b: Uint8Array, mime: AllowedMime, reasons: string[], warns: string[]): void {
  const text = new TextDecoder().decode(b)
  if (text.startsWith('#!')) reasons.push('Tệp bắt đầu như một script chạy được')
  if (mime === 'text/csv') {
    if (/(^|[,;\t\n])\s*[=+\-@]\s*(cmd|powershell|mshta|rundll32)\b/i.test(text) || /\|\s*'?\s*\/c\b/i.test(text)) {
      reasons.push('Có công thức chạy lệnh trong bảng tính (DDE)')
    } else if (/(^|[,;\t\n])\s*"?[=@]/.test(text) || /(^|[,;\t\n])\s*"?[+-][A-Za-z(]/.test(text)) {
      warns.push('Có ô bắt đầu bằng ký tự công thức (= + - @). Excel có thể chạy chúng khi mở')
    }
  }
}

export function scanFile(bytes: Uint8Array, mime: AllowedMime): ScanResult {
  const reasons: string[] = []
  const warns: string[] = []
  const startsWith = (sig: number[]) => sig.every((v, i) => bytes[i] === v)
  if (startsWith([0x4d, 0x5a]) || startsWith([0x7f, 0x45, 0x4c, 0x46]) || startsWith([0xca, 0xfe, 0xba, 0xbe]) || startsWith([0xcf, 0xfa, 0xed, 0xfe])) {
    reasons.push('Nội dung là chương trình thực thi')
  }
  switch (mime) {
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      scanZip(bytes, reasons)
      break
    case 'application/vnd.ms-excel':
    case 'application/msword':
      scanOle(bytes, reasons)
      break
    case 'application/pdf':
      scanPdf(bytes, reasons)
      break
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
      scanImage(bytes, mime, reasons)
      break
    case 'text/plain':
    case 'text/csv':
      scanText(bytes, mime, reasons, warns)
      break
  }
  if (reasons.length > 0) return { verdict: 'block', reasons, scanner: SCANNER }
  if (warns.length > 0) return { verdict: 'warn', reasons: warns, scanner: SCANNER }
  return { verdict: 'clean', reasons: [], scanner: SCANNER }
}
