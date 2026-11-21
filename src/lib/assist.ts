import { blockText } from '@/content/blocks'
import { DOCS, docHref, localize } from '@/content/docs'
import { FAQ } from '@/content/faq'

/** Lower case, no accents and no punctuation, so "Tôi phải làm gì" matches "toi phai lam gi". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const STOP = new Set(['la', 'va', 'cua', 'the', 'nao', 'sao', 'co', 'khong', 'toi', 'ban', 'minh', 'duoc', 'cho', 'mot', 'nhung', 'thi', 'ma', 'de', 'is', 'the', 'a', 'an', 'to', 'of', 'do', 'i', 'my', 'how', 'what', 'can', 'and', 'or', 'in', 'on'])
const tokens = (s: string) => normalize(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t))

export type Intent = 'next' | 'balance' | 'deadline' | null

/** The few questions that are about the user's own deal and need live data, not the docs. */
export function intentOf(q: string): Intent {
  const n = normalize(q)
  if (/(lam gi|tiep theo|buoc tiep|viec can lam|can lam gi|what next|next step|what do i need|what do i do|do next|what now|to do|todo)/.test(n)) return 'next'
  if (/(so du|bao nhieu tien|tien cua toi|cho nhan|balance|how much|claimable|locked)/.test(n)) return 'balance'
  if (/(^| )han( |$)|(han chot|deadline|het han|khi nao het|when does|due date)/.test(n)) return 'deadline'
  return null
}

export interface DocHit {
  title: string
  text: string
  to: string
}

interface Unit {
  title: string
  text: string
  to: string
  weight: number
  hay: string
}

function units(lang: 'vi' | 'en'): Unit[] {
  const out: Unit[] = []
  for (const g of FAQ) {
    for (const it of g.items) {
      const q = lang === 'en' ? it.qEn : it.q
      const a = lang === 'en' ? it.aEn : it.a
      out.push({ title: q, text: a, to: it.to, weight: 3, hay: normalize(`${q} ${a}`) })
    }
  }
  for (const d of DOCS) {
    const L = localize(d, lang)
    const to = docHref(d)
    out.push({ title: L.title, text: L.summary, to, weight: 2, hay: normalize(`${L.title} ${L.summary}`) })
    for (const b of L.blocks) {
      const t = blockText(b)
      if (t.length > 40) out.push({ title: L.title, text: t, to, weight: 1, hay: normalize(t) })
    }
  }
  return out
}

/** Keyword search over the FAQ and the docs. Best matches first, one per article. */
export function searchHelp(query: string, lang: 'vi' | 'en', limit = 2): DocHit[] {
  const words = tokens(query)
  if (words.length === 0) return []
  const scored = units(lang)
    .map((u) => {
      let score = 0
      let hit = 0
      for (const w of words) {
        if (u.hay.includes(w)) {
          score += u.weight
          hit++
        }
      }
      // Prefer units that match most of the words, not just one common word.
      return { u, score: hit >= Math.min(2, words.length) ? score * (1 + hit / words.length) : 0 }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const hits: DocHit[] = []
  for (const { u } of scored) {
    if (seen.has(u.to)) continue
    seen.add(u.to)
    hits.push({ title: u.title, text: u.text.length > 320 ? `${u.text.slice(0, 317)}...` : u.text, to: u.to })
    if (hits.length >= limit) break
  }
  return hits
}
