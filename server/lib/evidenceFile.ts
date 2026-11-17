export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'] as const
export type AllowedMime = (typeof ALLOWED_MIME)[number]

/** The bytes must match the declared type, so a script cannot be smuggled in as an image. */
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
    case 'text/plain':
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        return !bytes.includes(0)
      } catch {
        return false
      }
  }
}

