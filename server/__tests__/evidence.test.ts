import { describe, expect, it } from 'vitest'
import { matchesMime } from '../lib/evidenceFile'

const bytes = (...b: number[]) => new Uint8Array(b)

describe('evidence file type check', () => {
  it('accepts real file signatures', () => {
    expect(matchesMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), 'image/png')).toBe(true)
    expect(matchesMime(bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg')).toBe(true)
    expect(matchesMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), 'application/pdf')).toBe(true)
    expect(matchesMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50), 'image/webp')).toBe(true)
    expect(matchesMime(new TextEncoder().encode('tin nhắn xác nhận đã nhận hàng'), 'text/plain')).toBe(true)
  })

  it('rejects content that does not match the declared type', () => {
    const html = new TextEncoder().encode('<script>alert(1)</script>')
    expect(matchesMime(html, 'image/png')).toBe(false)
    expect(matchesMime(html, 'application/pdf')).toBe(false)
    expect(matchesMime(bytes(0xff, 0xd8, 0xff), 'image/png')).toBe(false)
  })

  it('rejects binary data declared as text', () => {
    expect(matchesMime(bytes(0x41, 0x00, 0x42), 'text/plain')).toBe(false)
    expect(matchesMime(bytes(0xff, 0xfe, 0xfd), 'text/plain')).toBe(false)
  })
})
