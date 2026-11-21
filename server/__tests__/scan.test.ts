import { describe, expect, it } from 'vitest'
import { scanFile } from '../lib/scan'

const enc = (s: string) => new TextEncoder().encode(s)
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** A stored-method zip. `claim` overrides the uncompressed size written in the central directory. */
function zip(entries: Array<{ name: string; data?: string; claim?: number }>): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc(e.name)
    const data = enc(e.data ?? 'x')
    const lh = new Uint8Array(30 + name.length)
    const lv = new DataView(lh.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    lh.set(name, 30)
    const ch = new Uint8Array(46 + name.length)
    const cv = new DataView(ch.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, e.claim ?? data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    ch.set(name, 46)
    locals.push(lh, data)
    centrals.push(ch)
    offset += lh.length + data.length
  }
  const cd = cat(...centrals)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cd.length, true)
  ev.setUint32(16, offset, true)
  return cat(...locals, cd, end)
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const png = (tail = 0) =>
  cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), enc('....IHDR....'), enc('IEND'), new Uint8Array(4), new Uint8Array(tail))

describe('scanFile', () => {
  it('passes an ordinary Word and Excel container', () => {
    expect(scanFile(zip([{ name: '[Content_Types].xml' }, { name: 'word/document.xml' }]), DOCX).verdict).toBe('clean')
    expect(scanFile(zip([{ name: '[Content_Types].xml' }, { name: 'xl/workbook.xml' }]), XLSX).verdict).toBe('clean')
  })
  it('blocks macros, ActiveX, embedded objects and scripts inside an Office file', () => {
    for (const name of ['word/vbaProject.bin', 'word/activeX/activeX1.xml', 'word/embeddings/oleObject1.bin', 'payload.exe', 'x/run.ps1']) {
      expect(scanFile(zip([{ name: '[Content_Types].xml' }, { name }]), DOCX).verdict, name).toBe('block')
    }
  })
  it('blocks a zip bomb and a malformed container', () => {
    expect(scanFile(zip([{ name: 'big.xml', data: 'a'.repeat(2000), claim: 150 * 1024 * 1024 }]), DOCX).verdict).toBe('block')
    expect(scanFile(cat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), enc('not a zip')), DOCX).verdict).toBe('block')
  })
  it('flags macros in a legacy Office file', () => {
    const ole = cat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), new Uint8Array([0x56, 0, 0x42, 0, 0x41, 0]))
    expect(scanFile(ole, 'application/vnd.ms-excel').verdict).toBe('block')
    const clean = cat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), enc('plain sheet'))
    expect(scanFile(clean, 'application/vnd.ms-excel').verdict).toBe('clean')
  })
  it('blocks PDF scripts, including hex-obfuscated names', () => {
    expect(scanFile(enc('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj'), 'application/pdf').verdict).toBe('clean')
    expect(scanFile(enc('%PDF-1.4\n<</S/JavaScript/JS(app.alert(1))>>'), 'application/pdf').verdict).toBe('block')
    expect(scanFile(enc('%PDF-1.4\n<</S/#4AavaScript>>'), 'application/pdf').verdict).toBe('block')
    expect(scanFile(enc('%PDF-1.4\n<</Type/EmbeddedFile>>'), 'application/pdf').verdict).toBe('block')
  })
  it('blocks data hidden after an image', () => {
    expect(scanFile(png(), 'image/png').verdict).toBe('clean')
    expect(scanFile(png(5000), 'image/png').verdict).toBe('block')
  })
  it('handles text and CSV', () => {
    expect(scanFile(enc('hello'), 'text/plain').verdict).toBe('clean')
    expect(scanFile(enc('#!/bin/sh\nrm -rf /'), 'text/plain').verdict).toBe('block')
    expect(scanFile(enc('a,b\n1,2\n'), 'text/csv').verdict).toBe('clean')
    expect(scanFile(enc('a,b\n=HYPERLINK("x"),2\n'), 'text/csv').verdict).toBe('warn')
    expect(scanFile(enc('a,b\n=cmd|\' /C calc\'!A0,2\n'), 'text/csv').verdict).toBe('block')
  })
  it('blocks a program disguised as a document', () => {
    expect(scanFile(cat(new Uint8Array([0x4d, 0x5a]), enc('....')), 'text/plain').verdict).toBe('block')
  })
})
