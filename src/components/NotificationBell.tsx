import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { describeNotification, type NotificationItem } from '@/lib/notifications'
import { formatDateTime } from '@/lib/format'

export interface NotificationsResponse {
  items: NotificationItem[]
  unread: number
}

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationsResponse>('/notifications'),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  })
}

export async function markRead(keys: string[]): Promise<void> {
  if (keys.length > 0) await api('/notifications', { body: { keys } })
}

const tone = { info: 'bg-[var(--accent)]', warn: 'bg-[var(--warn)]', urgent: 'bg-[var(--danger)]' } as const

/** Bell with the unread count and the latest few items. The full list is the inbox at /notifications. */
export function NotificationBell() {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const q = useNotifications(true)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const items = q.data?.items ?? []
  const unread = q.data?.unread ?? 0

  async function openItem(n: NotificationItem, to: string) {
    setOpen(false)
    await markRead([n.key]).catch(() => undefined)
    await qc.invalidateQueries({ queryKey: ['notifications'] })
    void navigate(to)
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-ghost relative !min-h-9 !px-3"
        aria-label={tr(`Thông báo, ${unread} chưa đọc`, `Notifications, ${unread} unread`)}
        aria-expanded={open}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-[min(22rem,90vw)] space-y-1 p-2 shadow-lg" role="dialog" aria-label={tr('Thông báo', 'Notifications')}>
          {items.length === 0 ? (
            <p className="p-3 text-sm text-[var(--muted)]">{tr('Chưa có thông báo nào.', 'No notifications yet.')}</p>
          ) : (
            items.slice(0, 6).map((n) => {
              const d = describeNotification(n, tr, lang)
              return (
                <button key={n.key} type="button" onClick={() => void openItem(n, d.to)} className={`flex w-full items-start gap-2 rounded-xl p-2 text-left hover:bg-white/70 ${n.read ? 'opacity-60' : ''}`}>
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${tone[n.severity]}`} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{d.title}</span>
                    <span className="block text-xs text-[var(--muted)]">{d.body}</span>
                    <span className="block text-[10px] text-[var(--subtle)]">{formatDateTime(n.at, lang)}</span>
                  </span>
                </button>
              )
            })
          )}
          <Link to="/notifications" onClick={() => setOpen(false)} className="block rounded-xl p-2 text-center text-xs font-semibold underline">
            {tr('Mở hộp thư', 'Open inbox')}
          </Link>
        </div>
      )}
    </div>
  )
}
