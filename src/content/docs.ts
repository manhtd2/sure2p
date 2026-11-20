import { blockText } from './blocks'
import { docsA } from './docsA'
import { docsB } from './docsB'
import { docsC } from './docsC'
import type { Doc } from './docTypes'

export * from './docTypes'
export const DOCS: Doc[] = [...docsA, ...docsB, ...docsC]

export function docByPath(path: string): Doc | undefined {
  return DOCS.find((d) => d.path === path)
}
export function docByCode(code: string): Doc | undefined {
  return DOCS.find((d) => d.code === code)
}
export function docHref(d: Doc): string {
  return d.path ? `/docs/${d.path}` : '/docs'
}
export function docSearchText(d: Doc): string {
  return `${d.title} ${d.summary} ${d.blocks.map(blockText).join(' ')}`.toLowerCase()
}
