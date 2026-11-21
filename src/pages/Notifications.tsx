import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useLang } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { describeNotification } from '@/lib/notifications'
import { Loader } from '@/components/Loader'
import { markRead, useNotifications } from '@/components/NotificationBell'

const dot = { info: 'bg-[var(--accent)]', warn: 'bg-[var(--warn)]', urgent: 'bg-[var(--danger)]' } as const

/** Inbox: every derived notification, with what to do next. Computed from live state, so nothing here can be stale. */
export default function Notifications() {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const q = useNotifications(true)
  if (q.isLoading || !q.data) return <Loader />
  const { items, unread } = q.data
  async function readAll() {
    await markRead(items.filter((i) => !i.read).map((i) => i.key))
    await qc.invalidateQueries({ queryKey: ['notifications'] })
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-bold">{tr('Thông báo', 'Notifications')}</h1>
          <p className="text-sm text-[var(--muted)]">
            {tr('Nhắc hạn, việc bên kia vừa làm, tranh chấp và kết quả xử lý. Tính từ trạng thái thật trên chuỗi mỗi lần bạn mở. Chưa có thông báo qua thư điện tử hay tin nhắn.', 'Deadline reminders, what the other side just did, disputes and rulings. Computed from live onchain state each time you open this. No email or SMS yet.')}
          </p>
        </div>
        {unread > 0 && <button type="button" className="btn btn-ghost" onClick={() => void readAll()}>{tr('Đánh dấu đã đọc tất cả', 'Mark all read')}</button>}
      </div>
      {items.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--muted)]">{tr('Chưa có thông báo nào.', 'No notifications yet.')}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const d = describeNotification(n, tr, lang)
            return (
              <li key={n.key}>
                <Link
                  to={d.to}
                  onClick={() => void markRead([n.key]).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}
                  className={`card flex items-start gap-3 p-4 ${n.read ? 'opacity-60' : ''}`}
                >
                  <span className={`mt-2 size-2.5 shrink-0 rounded-full ${dot[n.severity]}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{d.title}</span>
                    <span className="block text-sm text-[var(--ink-2)]">{d.body}</span>
                    <span className="mt-1 block text-xs text-[var(--subtle)]">{n.publicId ? <span className="mono">{n.publicId} · </span> : null}{formatDateTime(n.at, lang)}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
