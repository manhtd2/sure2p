import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, QrCode } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { formatDateTime, usdcWithCommas } from '@/lib/format'
import { useSession } from '@/hooks/useSession'
import { CHAIN_ID } from '@/lib/contracts'

interface Peek {
  inviterRole: 'buyer' | 'seller'
  yourRole: 'buyer' | 'seller'
  title: string
  priceUnits: string
  expiresAt: number
}

/**
 * The bearer token lives in the #fragment, which is never sent to a server. It is held in
 * sessionStorage only while the visitor signs in, then cleared once used.
 */
function readInviteToken(): string {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash.length >= 20) {
    sessionStorage.setItem('sure2p.invite', hash)
    return hash
  }
  return sessionStorage.getItem('sure2p.invite') ?? ''
}

/** Link, code and QR all land here and resolve to the same single invitation. */
export default function Join() {
  const { tr, lang } = useLang()
  const navigate = useNavigate()
  const { me, loading, hasWallet } = useSession()
  const [token] = useState(readInviteToken)
  const [code, setCode] = useState('')
  const [peek, setPeek] = useState<Peek | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const body = () => (token ? { token } : { code: code.trim() })
  const ready = Boolean(token) || code.trim().length >= 8

  useEffect(() => {
    if (!hasWallet || !token) return
    void (async () => {
      try {
        setPeek(await api<Peek>('/invitations/peek', { body: { token } }))
      } catch (e) {
        setError(errorText(e, tr))
      }
    })()
  }, [hasWallet, token, tr])

  async function lookup() {
    setBusy(true)
    setError(null)
    try {
      setPeek(await api<Peek>('/invitations/peek', { body: body() }))
    } catch (e) {
      setPeek(null)
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  async function claim() {
    setBusy(true)
    setError(null)
    try {
      const { draftId } = await api<{ draftId: string }>('/invitations/claim', { body: body() })
      // Remove the bearer token from the address bar once it has been used.
      history.replaceState(null, '', window.location.pathname)
      sessionStorage.removeItem('sure2p.invite')
      void navigate(`/transactions/${draftId}`)
    } catch (e) {
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-5 animate-spin text-[var(--muted)]" />
      </div>
    )
  }

  const needsSignIn = !hasWallet || me?.chainId !== CHAIN_ID

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="display text-3xl font-bold">{tr('Tham gia giao dịch', 'Join a transaction')}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {tr('Dùng liên kết, mã hoặc QR bạn nhận được. Cả ba đều mở cùng một lời mời.', 'Use the link, code or QR you received. All three open the same invitation.')}
        </p>
      </div>
      <section className="card space-y-4 p-5">
        {needsSignIn ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--ink-2)]">
              {tr('Bạn cần đăng nhập bằng số điện thoại và liên kết ví trước khi xem lời mời. Liên kết mời được giữ nguyên.', 'Sign in with your phone and link a wallet before viewing the invitation. Your invite link stays valid.')}
            </p>
            <a className="btn btn-primary w-full" href={`/sign-in?next=${encodeURIComponent('/join')}`} onClick={(e) => { e.preventDefault(); void navigate(`/sign-in?next=${encodeURIComponent('/join')}`) }}>
              {tr('Đăng nhập', 'Sign in')}
            </a>
            {token && <p className="text-xs text-[var(--subtle)]">{tr('Lời mời sẽ tự mở lại sau khi bạn đăng nhập xong.', 'The invitation reopens automatically after you sign in.')}</p>}
          </div>
        ) : (
          <>
            {!token && (
              <div>
                <label className="label" htmlFor="code">{tr('Mã mời', 'Invite code')}</label>
                <input id="code" className="field mono tracking-wider" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" />
              </div>
            )}
            {token && !peek && !error && (
              <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
                <QrCode className="size-4" /> {tr('Đang mở lời mời...', 'Opening invitation...')}
              </p>
            )}
            {!peek && !token && (
              <button type="button" className="btn btn-primary w-full" onClick={() => void lookup()} disabled={busy || !ready}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : tr('Xem lời mời', 'View invitation')}
              </button>
            )}
            {peek && (
              <div className="space-y-3">
                <div className="inner space-y-2 p-4 text-sm">
                  <div className="label">{tr('Lời mời', 'Invitation')}</div>
                  <div className="display text-lg font-semibold">{peek.title}</div>
                  <div className="flex justify-between"><span className="text-[var(--muted)]">{tr('Giá', 'Price')}</span><span className="tabular-nums font-semibold">{usdcWithCommas(peek.priceUnits)} USDC</span></div>
                  <div className="flex justify-between"><span className="text-[var(--muted)]">{tr('Bạn sẽ là', 'You would be the')}</span><span className="font-semibold">{peek.yourRole === 'buyer' ? 'Buyer' : 'Seller'}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--muted)]">{tr('Hết hạn', 'Expires')}</span><span>{formatDateTime(peek.expiresAt, lang)}</span></div>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {tr('Tham gia chưa phải đồng ý. Bạn sẽ xem đầy đủ điều khoản và chọn chấp nhận hoặc đề xuất lại trước khi ký.', 'Joining is not consent. You will review the full terms and accept or counter before signing.')}
                </p>
                <button type="button" className="btn btn-primary w-full" onClick={() => void claim()} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : tr('Tham gia và xem điều khoản', 'Join and review terms')}
                </button>
              </div>
            )}
          </>
        )}
        {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}
      </section>
    </div>
  )
}
