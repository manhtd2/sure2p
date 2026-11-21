import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, Hourglass, UserRound } from 'lucide-react'
import { useLang } from '@/i18n'
import { useNow } from '@/hooks/useNow'
import { formatDuration } from '@/lib/format'
import { describeTodo, type TodoItem } from '@/lib/notifications'

const WAIT_LABEL: Record<TodoItem['waitingOn'], [string, string]> = {
  me: ['Đến lượt bạn', 'Your turn'],
  other: ['Chờ bên kia', 'Waiting for the other side'],
  arbiter: ['Chờ Arbiter', 'Waiting for the Arbiter'],
  reviewer: ['Chờ người xem xét', 'Waiting for the reviewer'],
  anyone: ['Ai cũng làm được', 'Anyone can do it'],
}

/** The next step of each deal: who must act, by when, and a shortcut to prepare it. */
export function TodoList({ todos, onPrepare }: { todos: TodoItem[]; onPrepare: (t: TodoItem) => void }) {
  const { tr, lang } = useLang()
  const now = useNow(30_000)
  if (todos.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-white/70 p-3 text-sm text-[var(--ink-2)]">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
        {tr('Không có việc nào đang chờ bạn. Khi có giao dịch mới, các bước cần làm sẽ hiện ở đây.', 'Nothing is waiting for you. Next steps will show here as your deals move.')}
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {todos.map((t) => {
        const d = describeTodo(t, tr)
        const mine = t.waitingOn === 'me'
        const left = t.deadline ? t.deadline - now : null
        return (
          <li key={t.key} className={`rounded-xl border p-3 text-sm ${mine ? 'border-[var(--accent)] bg-white' : 'border-[var(--border)] bg-white/60'}`}>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              {mine ? <UserRound className="size-3.5" /> : <Hourglass className="size-3.5" />}
              {tr(...WAIT_LABEL[t.waitingOn])}
              {t.publicId && <span className="mono normal-case">{t.publicId}</span>}
            </p>
            <p className="mt-1 font-semibold">{d.title}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{d.hint}</p>
            {left !== null && (
              <p className={`mt-1 flex items-center gap-1 text-xs ${left <= 6 * 3600 ? 'font-semibold text-[var(--danger)]' : 'text-[var(--muted)]'}`}>
                <Clock className="size-3.5" />
                {left > 0 ? tr(`Còn ${formatDuration(left, lang)}`, `${formatDuration(left, lang)} left`) : tr('Đã quá hạn', 'Past the deadline')}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {t.action && mine && (
                <button type="button" className="btn btn-primary !min-h-8 !px-3 text-xs" onClick={() => onPrepare(t)}>
                  {tr('Chuẩn bị', 'Prepare')}
                </button>
              )}
              <Link to={d.to} className="btn btn-ghost !min-h-8 !px-3 text-xs">{tr('Mở giao dịch', 'Open deal')}</Link>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
