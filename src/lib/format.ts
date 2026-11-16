import { formatUsdc } from '@/onchain-money'

export function shortAddress(addr: string | null | undefined): string {
  if (!addr) return '-'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

/** Raw USDC base units (bigint or decimal string) to a display string such as "125" or "12.5". */
export function usdc(raw: bigint | string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '0'
  return formatUsdc(typeof raw === 'bigint' ? raw : BigInt(raw))
}

export function usdcWithCommas(raw: bigint | string | null | undefined): string {
  const [whole, frac] = usdc(raw).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}

export function formatDateTime(sec: number, lang: 'vi' | 'en'): string {
  return new Date(sec * 1000).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatDuration(totalSec: number, lang: 'vi' | 'en'): string {
  const s = Math.max(0, Math.floor(totalSec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const dl = lang === 'vi' ? 'ngày' : 'd'
  if (d > 0) return `${d} ${dl} ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

/** Datetime-local input value for a unix timestamp, in the browser's timezone. */
export function toLocalInput(sec: number): string {
  const d = new Date(sec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000)
}
