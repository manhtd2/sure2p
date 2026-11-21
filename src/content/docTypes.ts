import type { Block } from './blocks'

export type DocGroup = 'start' | 'trading' | 'disputes' | 'trust' | 'product' | 'technical' | 'resources'

export interface Doc {
  code: string
  group: DocGroup
  /** Path under /docs, e.g. "trading/funding"; empty for the docs home. */
  path: string
  title: string
  summary: string
  priority: 'P0' | 'P1'
  /** Spec section the article is written from. */
  spec: string
  related: string[]
  blocks: Block[]
}

/** English reference translation of one article. The Vietnamese article is the controlling version. */
export interface DocEn {
  title: string
  summary: string
  blocks: Block[]
}

export const DOC_VERSION = '2026-11-20'
export const DOC_REVIEWED = '2026-11-20'

export const GROUP_TITLES: Record<DocGroup, string> = {
  start: 'Bắt đầu',
  trading: 'Giao dịch',
  disputes: 'Tranh chấp',
  trust: 'Minh bạch',
  product: 'Sản phẩm',
  technical: 'Kỹ thuật',
  resources: 'Tài nguyên',
}

export const GROUP_TITLES_EN: Record<DocGroup, string> = {
  start: 'Getting started',
  trading: 'Trading',
  disputes: 'Disputes',
  trust: 'Trust',
  product: 'Product',
  technical: 'Technical',
  resources: 'Resources',
}
