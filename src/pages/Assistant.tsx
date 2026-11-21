import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, FileSearch, MessageSquare, Send, Wrench } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { Loader } from '@/components/Loader'
import { ActionPreview } from '@/components/ActionPreview'
import type { ListItem } from '@/lib/types'

interface ToolInfo {
  name: string
  kind: 'read' | 'prepare'
  description: string
  parameters: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] }
}
interface AssistantInfo {
  chat: { enabled: boolean }
  ttlSeconds: number
  tools: ToolInfo[]
}

const NAMES: Record<string, [string, string]> = {
  getMyTransactions: ['Giao dịch của tôi', 'My deals'],
  getTransactionDetails: ['Chi tiết một giao dịch', 'Deal details'],
  getEscrowBalances: ['Số tiền khóa và chờ nhận', 'Locked and claimable amounts'],
  getDisputeStatus: ['Trạng thái tranh chấp', 'Dispute status'],
  prepareAgreement: ['Soạn thỏa thuận mới', 'Draft a new agreement'],
  prepareInvitation: ['Tạo lời mời', 'Create an invitation'],
  prepareCounteroffer: ['Đề xuất sửa điều khoản', 'Propose changed terms'],
  prepareFunding: ['Nạp tiền', 'Fund my side'],
  prepareConfirmation: ['Bàn giao, nhận hàng, chấp thuận', 'Handover, receipt, acceptance'],
  prepareMutualSettlement: ['Thỏa thuận chung', 'Mutual settlement'],
  prepareDisputeOrAppeal: ['Mở tranh chấp hoặc kháng cáo', 'Open a dispute or appeal'],
  prepareClaim: ['Nhận tiền', 'Claim funds'],
}

/** Builds a form from the tool's own JSON schema, so every tool is reachable without the chat. */
function ToolForm({ tool, deals, drafts, onPreview, onRead }: { tool: ToolInfo; deals: string[]; drafts: string[]; onPreview: (id: string) => void; onRead: (data: unknown) => void }) {
  const { tr } = useLang()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const props = Object.entries(tool.parameters.properties ?? {})

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const input: Record<string, unknown> = {}
      for (const [k, spec] of props) {
        const raw = values[k]
        if (raw === undefined || raw === '') continue
        input[k] = spec.type === 'number' || spec.type === 'integer' ? Number(raw) : raw
      }
      if (tool.kind === 'read') {
        const r = await api<{ data: unknown }>('/actions?op=read', { body: { tool: tool.name, input } })
        onRead(r.data)
      } else {
        const r = await api<{ id: string }>('/actions?op=prepare', { body: { tool: tool.name, input } })
        onPreview(r.id)
      }
    } catch (err) {
      setError(errorText(err, tr))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <p className="text-sm text-[var(--muted)]">{tool.description}</p>
      {props.map(([k, spec]) => {
        const required = tool.parameters.required?.includes(k)
        const options = k === 'publicId' ? deals : k === 'draftId' ? drafts : spec.enum
        return (
          <div key={k}>
            <label className="label" htmlFor={`${tool.name}-${k}`}>{k}{required ? ' *' : ''}</label>
            {options && options.length > 0 ? (
              <select id={`${tool.name}-${k}`} className="field" value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} required={required}>
                <option value="">{tr('Chọn...', 'Choose...')}</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input id={`${tool.name}-${k}`} className="field" value={values[k] ?? ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} required={required} />
            )}
            {spec.description && <p className="mt-1 text-xs text-[var(--subtle)]">{spec.description}</p>}
          </div>
        )
      })}
      {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{tool.kind === 'read' ? tr('Xem', 'Look up') : tr('Chuẩn bị bản xem trước', 'Prepare a preview')}</button>
    </form>
  )
}

function Chat({ onPreview }: { onPreview: (id: string) => void }) {
  const { tr } = useLang()
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const next = [...messages, { role: 'user' as const, content: text.trim() }]
    if (!text.trim()) return
    setMessages(next)
    setText('')
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ reply: string; previews: string[] }>('/assistant', { body: { messages: next.slice(-20) } })
      setMessages([...next, { role: 'assistant', content: r.reply }])
      if (r.previews[0]) onPreview(r.previews[r.previews.length - 1])
    } catch (err) {
      setError(errorText(err, tr))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-3 p-5">
      <h2 className="display flex items-center gap-2 text-lg font-bold"><MessageSquare className="size-4" /> {tr('Trò chuyện', 'Chat')}</h2>
      <p className="text-xs text-[var(--muted)]">{tr('Cuộc trò chuyện không được lưu. Mô hình không nhận bằng chứng, khóa hay dữ liệu của người khác, và không thể ký hay gửi gì.', 'The conversation is not stored. The model does not receive evidence, keys or other people\'s data, and cannot sign or send anything.')}</p>
      <ul className="max-h-72 space-y-2 overflow-y-auto" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i} className={`rounded-xl p-3 text-sm ${m.role === 'user' ? 'ml-8 bg-white/80' : 'mr-8 bg-[var(--surface-2)]'}`}>{m.content}</li>
        ))}
      </ul>
      {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}
      <form onSubmit={(e) => void send(e)} className="flex gap-2">
        <input className="field flex-1" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={tr('Hỏi về giao dịch của bạn...', 'Ask about your deals...')} aria-label={tr('Tin nhắn', 'Message')} />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()} aria-label={tr('Gửi', 'Send')}><Send className="size-4" /></button>
      </form>
    </section>
  )
}

export default function Assistant() {
  const { tr } = useLang()
  const info = useQuery({ queryKey: ['assistant'], queryFn: () => api<AssistantInfo>('/assistant') })
  const list = useQuery({ queryKey: ['transactions'], queryFn: () => api<{ items: ListItem[] }>('/transactions') })
  const [active, setActive] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [readResult, setReadResult] = useState<unknown>(null)
  if (info.isLoading || !info.data) return info.error ? <p className="card p-6 text-sm text-[var(--danger)]">{errorText(info.error, tr)}</p> : <Loader />

  const items = list.data?.items ?? []
  const deals = items.filter((i) => i.kind === 'escrow').map((i) => (i as { publicId: string }).publicId)
  const drafts = items.filter((i) => i.kind === 'draft').map((i) => (i as { ref: string }).ref)
  const tool = info.data.tools.find((t) => t.name === active)

  return (
    <div className="space-y-5">
      <div>
        <span className="chip"><Bot className="size-3.5" /> {tr('Chỉ chuẩn bị', 'Prepares only')}</span>
        <h1 className="display mt-2 text-3xl font-bold">{tr('Trợ lý', 'Assistant')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-2)]">
          {tr(
            'Trợ lý đọc giao dịch của chính bạn và soạn bản xem trước hành động. Nó không ký, không gửi giao dịch, không phán quyết, không phạt, không cấm ai. Mỗi bản xem trước hết hạn sau 300 giây và chỉ chạy khi bạn bấm tiếp tục, rồi ví của bạn tự ký.',
            'The assistant reads your own deals and prepares previews. It does not sign, send, rule, penalize or ban. Each preview expires after 300 seconds and only runs when you press Continue; your wallet then signs.',
          )}
        </p>
      </div>
      {info.data.chat.enabled ? (
        <Chat onPreview={setPreviewId} />
      ) : (
        <p className="card p-4 text-sm text-[var(--muted)]">
          {tr('Trò chuyện bằng mô hình chưa bật trên bản này (chưa có khóa nhà cung cấp). Mười hai công cụ bên dưới vẫn dùng được đầy đủ.', 'Model chat is not enabled on this deployment (no provider key). The twelve tools below work in full.')}
        </p>
      )}

      {previewId && <ActionPreview key={previewId} id={previewId} onClose={() => setPreviewId(null)} />}

      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <nav className="card space-y-1 p-2" aria-label={tr('Công cụ', 'Tools')}>
          {info.data.tools.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => { setActive(t.name); setReadResult(null) }}
              className={`flex w-full items-center gap-2 rounded-xl p-2.5 text-left text-sm ${active === t.name ? 'bg-[var(--accent)] text-white' : 'hover:bg-white/70'}`}
            >
              {t.kind === 'read' ? <FileSearch className="size-4 shrink-0" /> : <Wrench className="size-4 shrink-0" />}
              <span>{tr(...(NAMES[t.name] ?? [t.name, t.name]))}</span>
            </button>
          ))}
        </nav>
        <section className="card space-y-4 p-5">
          {!tool ? (
            <p className="text-sm text-[var(--muted)]">{tr('Chọn một công cụ bên trái.', 'Pick a tool on the left.')}</p>
          ) : (
            <>
              <h2 className="display text-lg font-bold">{tr(...(NAMES[tool.name] ?? [tool.name, tool.name]))}</h2>
              <ToolForm key={tool.name} tool={tool} deals={deals} drafts={drafts} onPreview={setPreviewId} onRead={setReadResult} />
              {readResult !== null && <pre className="inner mono max-h-96 overflow-auto p-3 text-xs">{JSON.stringify(readResult, null, 2)}</pre>}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
