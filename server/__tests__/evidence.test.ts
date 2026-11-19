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

describe('office and csv files', () => {
  const ooxml = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)
  const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00)
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  it('accepts zip containers as xlsx and docx, and OLE containers as xls and doc', () => {
    expect(matchesMime(ooxml, xlsx)).toBe(true)
    expect(matchesMime(ooxml, docx)).toBe(true)
    expect(matchesMime(ole, 'application/vnd.ms-excel')).toBe(true)
    expect(matchesMime(ole, 'application/msword')).toBe(true)
  })

  it('rejects the wrong container and renamed scripts', () => {
    expect(matchesMime(ole, xlsx)).toBe(false)
    expect(matchesMime(ooxml, 'application/vnd.ms-excel')).toBe(false)
    expect(matchesMime(new TextEncoder().encode('<html></html>'), xlsx)).toBe(false)
  })

  it('accepts csv text and rejects binary csv', () => {
    expect(matchesMime(new TextEncoder().encode('ten,so luong\nbut,2\n'), 'text/csv')).toBe(true)
    expect(matchesMime(ooxml, 'text/csv')).toBe(false)
  })
})
