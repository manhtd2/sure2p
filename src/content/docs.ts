import { blockText } from './blocks'
import { docsA } from './docsA'
import { docsB } from './docsB'
import { docsC } from './docsC'
import { docsEnA } from './docsEnA'
import { docsEnB } from './docsEnB'
import type { Doc, DocEn } from './docTypes'

export * from './docTypes'
export const DOCS: Doc[] = [...docsA, ...docsB, ...docsC]

/** English reference text when it exists; the Vietnamese article controls. */
export function docEn(d: Doc): DocEn | undefined {
  return docsEnA[d.code] ?? docsEnB[d.code]
}
export function docByPath(path: string): Doc | undefined {
  return DOCS.find((d) => d.path === path)
}
export function docByCode(code: string): Doc | undefined {
  return DOCS.find((d) => d.code === code)
}
export function docHref(d: Doc): string {
  return d.path ? `/docs/${d.path}` : '/docs'
}
export function docSearchText(d: Doc, lang: 'vi' | 'en' = 'vi'): string {
  const en = lang === 'en' ? docEn(d) : undefined
  const title = en?.title ?? d.title
  const summary = en?.summary ?? d.summary
  const blocks = en?.blocks ?? d.blocks
  return `${title} ${summary} ${blocks.map(blockText).join(' ')}`.toLowerCase()
}

/** Title, summary and blocks in the reader's language. `translated` is false when only the Vietnamese exists. */
export function localize(d: Doc, lang: 'vi' | 'en'): { title: string; summary: string; blocks: Doc['blocks']; translated: boolean } {
  const en = lang === 'en' ? docEn(d) : undefined
  return en ? { ...en, translated: true } : { title: d.title, summary: d.summary, blocks: d.blocks, translated: lang === 'vi' }
}
