import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'

export default function Contact() {
  const { lang, tr } = useLang()
  const [topic, setTopic] = useState('other')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [publicId, setPublicId] = useState('')
  const [website, setWebsite] = useState('')
  const send = useMutation({
    mutationFn: () => api('/contact', { body: { topic, message, email, publicId, website } }),
  })
  const topics: Array<[string, string, string]> = [
    ['account', 'Tài khoản và ví', 'Account and wallet'],
    ['transaction', 'Một giao dịch', 'A transaction'],
    ['dispute', 'Tranh chấp (đã có hồ sơ thì dùng trang giao dịch)', 'Dispute (use the deal page if a case is open)'],
    ['security', 'Bảo mật / báo lỗ hổng', 'Security / vulnerability report'],
    ['other', 'Khác', 'Other'],
  ]
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="display text-3xl font-bold">{tr('Liên hệ', 'Contact')}</h1>
      <p className="rounded-xl bg-[#fff8e6] p-3 text-sm text-[var(--warn)]">
        {tr(
          'Không bao giờ gửi cụm từ khôi phục, khóa riêng hay mật khẩu. Vụ tranh chấp đang mở hãy dùng hồ sơ của vụ đó, đừng dùng biểu mẫu này.',
          'Never send recovery phrases, private keys or passwords. For an open dispute use that case, not this form.',
        )}
      </p>
      <p className="text-sm text-[var(--muted)]">
        {tr(
          'Tin nhắn được lưu để đội vận hành đọc. Chưa có kênh trả lời tự động và chưa có thư điện tử hỗ trợ công khai (đang chờ quyết định D01 và D04), nên hãy để lại thư điện tử nếu bạn muốn được trả lời.',
          'Messages are stored for the team to read. There is no automatic reply channel or public support email yet (decisions D01 and D04 pending), so leave an email if you want an answer.',
        )}
      </p>
      {send.isSuccess ? (
        <div className="card p-5" role="status">{tr('Đã nhận tin nhắn của bạn.', 'Your message was received.')}</div>
      ) : (
        <form
          className="card space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            send.mutate()
          }}
        >
          <div>
            <label className="label" htmlFor="topic">{tr('Chủ đề', 'Topic')}</label>
            <select id="topic" className="field" value={topic} onChange={(e) => setTopic(e.target.value)}>
              {topics.map(([v, vi, en]) => <option key={v} value={v}>{lang === 'vi' ? vi : en}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="msg">{tr('Nội dung (10 đến 2000 ký tự)', 'Message (10 to 2000 characters)')}</label>
            <textarea id="msg" className="field min-h-32" required minLength={10} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="email">{tr('Thư điện tử (không bắt buộc)', 'Email (optional)')}</label>
              <input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pid">{tr('Mã công khai giao dịch (không bắt buộc)', 'Deal public ID (optional)')}</label>
              <input id="pid" className="field mono" maxLength={12} value={publicId} onChange={(e) => setPublicId(e.target.value)} />
            </div>
          </div>
          <div aria-hidden className="absolute -left-[9999px]">
            <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
          </div>
          {send.isError && <p className="text-sm text-[var(--danger)]" role="alert">{errorText(send.error, tr)}</p>}
          <button className="btn btn-primary" disabled={send.isPending || message.trim().length < 10}>
            {send.isPending ? tr('Đang gửi...', 'Sending...') : tr('Gửi', 'Send')}
          </button>
        </form>
      )}
    </div>
  )
}
