import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bot, GripHorizontal, MessageCircle, Minus, Send, X } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { intentOf, searchHelp } from '@/lib/assist'
import type { TodoItem } from '@/lib/notifications'
import type { ListItem } from '@/lib/types'
import { ActionPreview } from './ActionPreview'
import { useNotifications } from './NotificationBell'
import { TodoList } from './TodoList'

interface Msg {
  role: 'user' | 'bot'
  text: string
  links?: Array<{ label: string; to: string }>
  todos?: TodoItem[]
}

interface Pos {
  x: number
  y: number
}

const POS_KEY = 'sure2p.chat.pos'
const OPEN_KEY = 'sure2p.chat.open'
const W = 380
const H = 560
const MARGIN = 8

function clamp(p: Pos, w: number, h: number): Pos {
  return {
    x: Math.min(Math.max(MARGIN, p.x), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: Math.min(Math.max(MARGIN, p.y), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  }
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Pos
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p
    }
  } catch {
    /* fall through to the default corner */
  }
  return { x: window.innerWidth - W - 16, y: window.innerHeight - H - 80 }
}

/**
 * A floating chat window you can drag anywhere. It lists what you need to do at each step of your deals, answers
 * questions from the docs and the FAQ (and from a model when the deployment turns one on), and opens previews.
 * It never signs or sends anything: a preview needs your Continue, and a wallet call needs your wallet.
 */
export function ChatWidget() {
  const { tr, lang } = useLang()
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1')
  const [pos, setPos] = useState<Pos>(() => loadPos())
  const [small, setSmall] = useState(() => window.innerWidth < 640)
  const [tab, setTab] = useState<'todo' | 'chat'>('todo')
  const [deal, setDeal] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const log = useRef<HTMLUListElement>(null)

  const notif = useNotifications(true)
  const info = useQuery({ queryKey: ['assistant'], queryFn: () => api<{ chat: { enabled: boolean } }>('/assistant'), staleTime: 5 * 60_000, retry: false })
  const list = useQuery({ queryKey: ['transactions'], queryFn: () => api<{ items: ListItem[] }>('/transactions'), staleTime: 30_000 })
  const deals = (list.data?.items ?? []).filter((i) => i.kind === 'escrow') as Array<{ publicId: string; title?: string; stage: string }>
  const allTodos = notif.data?.todos ?? []
  const todos = deal ? allTodos.filter((t) => t.publicId === deal) : allTodos
  const mineCount = allTodos.filter((t) => t.waitingOn === 'me').length

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  }, [open])
  useEffect(() => {
    const onResize = () => {
      setSmall(window.innerWidth < 640)
      setPos((p) => clamp(p, W, H))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [msgs, busy])

  const move = useCallback((p: Pos) => {
    const c = clamp(p, W, H)
    setPos(c)
    return c
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current) move({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy })
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    localStorage.setItem(POS_KEY, JSON.stringify(pos))
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 64 : 16
    const d: Record<string, Pos> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }
    const delta = d[e.key]
    if (!delta) return
    e.preventDefault()
    localStorage.setItem(POS_KEY, JSON.stringify(move({ x: pos.x + delta.x, y: pos.y + delta.y })))
  }

  async function prepare(t: TodoItem) {
    if (!t.action) return
    setError(null)
    try {
      const r = await api<{ id: string }>('/actions?op=prepare', { body: { tool: t.action.tool, input: t.action.input } })
      setPreviewId(r.id)
    } catch (e) {
      setError(errorText(e, tr))
    }
  }

  async function ask(q: string) {
    const question = q.trim()
    if (!question) return
    setMsgs((m) => [...m, { role: 'user', text: question }])
    setText('')
    setBusy(true)
    setError(null)
    const push = (m: Msg) => setMsgs((all) => [...all, m])
    try {
      const intent = intentOf(question)
      if (intent === 'next') {
        const sel = deal ? allTodos.filter((t) => t.publicId === deal) : allTodos.filter((t) => t.waitingOn === 'me')
        push({
          role: 'bot',
          text: sel.length === 0
            ? tr('Không có việc nào đang chờ bạn lúc này.', 'Nothing is waiting for you right now.')
            : tr(`Bạn có ${sel.length} bước cần chú ý:`, `You have ${sel.length} step(s) to look at:`),
          todos: sel,
        })
      } else if (intent === 'balance' || intent === 'deadline') {
        if (!deal) {
          push({ role: 'bot', text: tr('Hãy chọn một giao dịch ở ô phía trên, rồi hỏi lại.', 'Pick a deal in the box above, then ask again.') })
        } else if (intent === 'balance') {
          const r = await api<{ data: { price: string; buyerDeposit: string; sellerDeposit: string; claimableByMyWallet: string; atBlock: string } }>('/actions?op=read', { body: { tool: 'getEscrowBalances', input: { publicId: deal } } })
          const d = r.data
          push({
            role: 'bot',
            text: tr(
              `Giá ${d.price}; cọc người mua ${d.buyerDeposit}; cọc người bán ${d.sellerDeposit}. Đang chờ về ví của bạn: ${d.claimableByMyWallet}. Đọc từ chuỗi tại khối ${d.atBlock}. Tiền chờ nhận chưa vào ví cho tới khi bạn nhận.`,
              `Price ${d.price}; buyer deposit ${d.buyerDeposit}; seller deposit ${d.sellerDeposit}. Waiting for your wallet: ${d.claimableByMyWallet}. Read from the chain at block ${d.atBlock}. Claimable money is not in your wallet until you claim.`,
            ),
            links: [{ label: tr('Mở giao dịch', 'Open deal'), to: `/transactions/${deal}` }],
          })
        } else {
          const r = await api<{ data: { fundingDeadline: number; handoverDeadline: number; buyerResponseSeconds: number; inspectionSeconds: number } }>('/actions?op=read', { body: { tool: 'getTransactionDetails', input: { publicId: deal } } })
          const d = r.data
          push({
            role: 'bot',
            text: tr(
              `Hạn nạp tiền: ${formatDateTime(d.fundingDeadline, lang)}. Hạn bàn giao: ${formatDateTime(d.handoverDeadline, lang)}. Cửa sổ phản hồi của người mua: ${d.buyerResponseSeconds / 3600} giờ. Cửa sổ kiểm tra: ${d.inspectionSeconds / 3600} giờ.`,
              `Funding deadline: ${formatDateTime(d.fundingDeadline, lang)}. Handover deadline: ${formatDateTime(d.handoverDeadline, lang)}. Buyer response window: ${d.buyerResponseSeconds / 3600} h. Inspection window: ${d.inspectionSeconds / 3600} h.`,
            ),
          })
        }
      } else if (info.data?.chat.enabled) {
        const history = [...msgs, { role: 'user' as const, text: question }].filter((m) => m.role === 'user' || m.text).slice(-12)
        const r = await api<{ reply: string; previews: string[] }>('/assistant', {
          body: { messages: history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.slice(0, 2000) })) },
        })
        push({ role: 'bot', text: r.reply })
        if (r.previews.length > 0) setPreviewId(r.previews[r.previews.length - 1])
      } else {
        const hits = searchHelp(question, lang)
        push(
          hits.length === 0
            ? { role: 'bot', text: tr('Tôi chưa tìm thấy bài nào khớp. Thử hỏi bằng từ khác (ví dụ: nạp tiền, kháng cáo, cọc), hoặc xem Hỏi đáp.', 'I could not find a matching article. Try other words (for example: funding, appeal, deposit), or open the FAQ.'), links: [{ label: tr('Hỏi đáp', 'FAQ'), to: '/faq' }] }
            : { role: 'bot', text: hits.map((h) => h.text).join('\n\n'), links: hits.map((h) => ({ label: h.title, to: h.to })) },
        )
      }
    } catch (e) {
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  const quick: Array<[string, string]> = [
    [tr('Tôi cần làm gì tiếp?', 'What do I do next?'), 'next'],
    [tr('Số tiền của tôi?', 'My amounts?'), 'balance'],
    [tr('Hạn của giao dịch?', 'Deadlines?'), 'deadline'],
    [tr('Khi nào mở tranh chấp?', 'When to open a dispute?'), 'dispute'],
  ]

  const style = small ? undefined : { left: pos.x, top: pos.y, width: W, height: H }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary fixed bottom-20 right-4 z-40 !min-h-12 !rounded-full !px-4 shadow-lg"
        aria-label={tr(`Mở khung chat, ${mineCount} việc đang chờ bạn`, `Open chat, ${mineCount} step(s) waiting for you`)}
      >
        <MessageCircle className="size-5" />
        <span className="hidden sm:inline">{tr('Trợ lý', 'Assistant')}</span>
        {mineCount > 0 && <span className="rounded-full bg-white px-1.5 text-xs font-bold text-[var(--accent)]">{mineCount}</span>}
      </button>
    )
  }

  return (
    <section
      className={`card fixed z-40 flex flex-col overflow-hidden shadow-2xl ${small ? 'inset-x-2 bottom-2 h-[75vh]' : ''}`}
      style={style}
      aria-label={tr('Khung chat trợ lý', 'Assistant chat window')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <div
        className={`flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--accent)] px-3 py-2 text-white ${small ? '' : 'cursor-grab touch-none select-none active:cursor-grabbing'}`}
        onPointerDown={small ? undefined : onPointerDown}
        onPointerMove={small ? undefined : onPointerMove}
        onPointerUp={small ? undefined : onPointerUp}
        onKeyDown={small ? undefined : onKeyDown}
        tabIndex={small ? undefined : 0}
        role="group"
        aria-label={tr('Thanh tiêu đề. Kéo chuột hoặc dùng phím mũi tên để di chuyển khung.', 'Title bar. Drag, or use the arrow keys, to move the window.')}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {!small && <GripHorizontal className="size-4 opacity-70" aria-hidden />}
          <Bot className="size-4" /> {tr('Trợ lý giao dịch', 'Deal assistant')}
        </span>
        <span className="flex gap-1">
          <button type="button" className="rounded-lg p-1.5 hover:bg-white/15" onClick={() => setOpen(false)} aria-label={tr('Thu nhỏ', 'Minimize')}><Minus className="size-4" /></button>
          <button type="button" className="rounded-lg p-1.5 hover:bg-white/15" onClick={() => { setOpen(false); setPreviewId(null) }} aria-label={tr('Đóng', 'Close')}><X className="size-4" /></button>
        </span>
      </div>

      <div className="space-y-2 border-b border-[var(--border)] p-2">
        <label className="sr-only" htmlFor="chat-deal">{tr('Giao dịch đang xem', 'Deal in focus')}</label>
        <select id="chat-deal" className="field !min-h-9 !py-1 text-sm" value={deal} onChange={(e) => setDeal(e.target.value)}>
          <option value="">{tr('Tất cả giao dịch của tôi', 'All my deals')}</option>
          {deals.map((d) => <option key={d.publicId} value={d.publicId}>{d.publicId} · {d.title ?? ''} · {d.stage}</option>)}
        </select>
        <div className="flex gap-1" role="tablist">
          {(['todo', 'chat'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${tab === k ? 'bg-[var(--accent)] text-white' : 'bg-white/70'}`}>
              {k === 'todo' ? `${tr('Việc cần làm', 'To do')}${mineCount > 0 ? ` (${mineCount})` : ''}` : tr('Hỏi đáp', 'Ask')}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {previewId ? (
          <ActionPreview key={previewId} id={previewId} onClose={() => setPreviewId(null)} />
        ) : tab === 'todo' ? (
          <div className="space-y-2">
            {notif.isLoading ? <p className="text-sm text-[var(--muted)]">{tr('Đang tải...', 'Loading...')}</p> : <TodoList todos={todos} onPrepare={(t) => void prepare(t)} />}
            {error && <p className="text-xs text-[var(--danger)]" role="alert">{error}</p>}
            <p className="text-[11px] text-[var(--subtle)]">{tr('Trợ lý chỉ chuẩn bị. Nó không ký, không gửi và không phán quyết thay bạn.', 'The assistant only prepares. It never signs, sends or rules for you.')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <ul ref={log} className="max-h-[22rem] space-y-2 overflow-y-auto" aria-live="polite">
              {msgs.length === 0 && <li className="text-sm text-[var(--muted)]">{tr('Hỏi tôi về từng bước của giao dịch, hạn chót, số tiền hoặc cách làm.', 'Ask me about each step of a deal, deadlines, amounts or how to do something.')}</li>}
              {msgs.map((m, i) => (
                <li key={i} className={`rounded-xl p-2.5 text-sm ${m.role === 'user' ? 'ml-8 bg-white' : 'mr-4 bg-[var(--surface-2)]'}`}>
                  <p className="whitespace-pre-line">{m.text}</p>
                  {m.todos && m.todos.length > 0 && <div className="mt-2"><TodoList todos={m.todos} onPrepare={(t) => void prepare(t)} /></div>}
                  {m.links && m.links.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-2 text-xs">{m.links.map((l) => <Link key={l.to + l.label} to={l.to} className="underline">{l.label}</Link>)}</p>
                  )}
                </li>
              ))}
              {busy && <li className="text-xs text-[var(--muted)]">{tr('Đang trả lời...', 'Answering...')}</li>}
            </ul>
            {error && <p className="text-xs text-[var(--danger)]" role="alert">{error}</p>}
            <div className="flex flex-wrap gap-1.5">
              {quick.map(([label, key]) => (
                <button key={key} type="button" className="chip hover:underline" onClick={() => void ask(label)}>{label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {tab === 'chat' && !previewId && (
        <form onSubmit={(e) => { e.preventDefault(); void ask(text) }} className="flex gap-2 border-t border-[var(--border)] p-2">
          <input className="field !min-h-9 flex-1 text-sm" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={tr('Nhập câu hỏi...', 'Type a question...')} aria-label={tr('Câu hỏi', 'Question')} />
          <button type="submit" className="btn btn-primary !min-h-9 !px-3" disabled={busy || !text.trim()} aria-label={tr('Gửi', 'Send')}><Send className="size-4" /></button>
        </form>
      )}
      <p className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--subtle)]">
        {info.data?.chat.enabled
          ? tr('Câu hỏi tự do được trả lời bằng mô hình; cuộc trò chuyện không được lưu.', 'Free questions are answered by a model; the conversation is not stored.')
          : tr('Trả lời lấy từ tài liệu và hỏi đáp của sure2p, không phải từ mô hình.', "Answers come from sure2p's docs and FAQ, not from a model.")}
      </p>
    </section>
  )
}
