import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useSignMessage, useSwitchChain } from 'wagmi'
import { CheckCircle2, FlaskConical, Loader2, Phone, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { CHAIN_ID } from '@/lib/contracts'
import { useSession } from '@/hooks/useSession'
import { parseTxError } from '@/hooks/useTx'
import PerfectTransactionHero from '@/components/PerfectTransactionHero'

interface OtpRequestResult {
  sent: boolean
  provider: string
  mockCode?: string
}

export default function SignIn() {
  const { tr } = useLang()
  const [params] = useSearchParams()
  const next = params.get('next') && params.get('next')!.startsWith('/') ? params.get('next')! : '/transactions'
  const { me, signedIn, hasWallet, refresh } = useSession()

  const [phone, setPhone] = useState('+84')
  const [code, setCode] = useState('')
  const [mockCode, setMockCode] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The page IS the perfect-transaction animation until the user starts
  // logging in; then the login card takes over prominently and the
  // animation is dimmed behind it so it cannot distract from the form.
  const [showLogin, setShowLogin] = useState(false)

  const { address, isConnected, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { signMessageAsync } = useSignMessage()

  if (hasWallet && me?.chainId === CHAIN_ID) return <Navigate to={next} replace />

  async function requestOtp() {
    setBusy(true)
    setError(null)
    try {
      const res = await api<OtpRequestResult>('/auth/otp/request', { body: { phone } })
      setSent(true)
      setMockCode(res.mockCode ?? null)
      // Mock provider: the server hands back the code, so verify it right away.
      // A real provider returns no code and the user types the SMS code instead.
      if (res.mockCode) {
        setCode(res.mockCode)
        await verifyOtp(res.mockCode)
        return
      }
    } catch (e) {
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  async function verifyOtp(otp: string = code) {
    setBusy(true)
    setError(null)
    try {
      await api('/auth/otp/verify', { body: { phone, code: otp } })
      await refresh()
    } catch (e) {
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  async function linkWallet() {
    if (!address) return
    setBusy(true)
    setError(null)
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
      const { message } = await api<{ message: string }>('/auth/wallet/challenge', { body: { address } })
      const signature = await signMessageAsync({ message })
      await api('/auth/wallet/verify', { body: { message, signature } })
      await refresh()
      toast.success(tr('Đã liên kết ví.', 'Wallet linked.'))
    } catch (e) {
      const parsed = parseTxError(e, tr)
      setError(parsed.rejected ? parsed.message : errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  const step = !signedIn ? 1 : 2
  // Once the user is mid-flow (OTP sent, or phone verified) the login card
  // stays visible even if they never pressed the hero CTA.
  const loginVisible = showLogin || signedIn || sent

  return (
    <div className="signin-cosmic relative -mx-4 -my-6">
      <div
        className={
          loginVisible
            ? 'pointer-events-none absolute inset-0 overflow-hidden opacity-[0.14] transition-opacity duration-700'
            : 'relative'
        }
        aria-hidden={loginVisible}
      >
        <PerfectTransactionHero onStartLogin={() => setShowLogin(true)} ctaVisible={!loginVisible} />
      </div>

      {loginVisible && (
        <div className="relative z-10 mx-auto flex min-h-[560px] w-full max-w-md flex-col justify-center px-4 py-10 sm:min-h-[620px]">
          <div className="space-y-4">
            <div>
              <h1 className="display text-3xl font-bold">{tr('Đăng nhập', 'Sign in')}</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {tr(
                  'Giao dịch tài chính cần cả số điện thoại đã xác thực và ví đã ký chứng minh quyền sở hữu.',
                  'Financial actions need both a verified phone number and a wallet that signed a proof of ownership.',
                )}
              </p>
            </div>

            <ol className="flex items-center gap-2 text-xs font-semibold">
              <li className={`chip ${step === 1 ? '!bg-[var(--accent)] !text-white' : ''}`}>
                {signedIn ? <CheckCircle2 className="size-3.5" /> : <Phone className="size-3.5" />} {tr('Số điện thoại', 'Phone')}
              </li>
              <li className={`chip ${step === 2 ? '!bg-[var(--accent)] !text-white' : ''}`}>
                <Wallet className="size-3.5" /> {tr('Ví', 'Wallet')}
              </li>
            </ol>

            {step === 1 && (
              <section className="card space-y-4 p-5">
                <div>
                  <label className="label" htmlFor="phone">
                    {tr('Số điện thoại (định dạng quốc tế)', 'Phone number (international format)')}
                  </label>
                  <input id="phone" className="field" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))} placeholder="+84901234567" disabled={sent} />
                </div>
                {!sent ? (
                  <>
                    <p className="flex items-start gap-2 rounded-xl border border-[#ecd49a] bg-[#fff4d6] p-3 text-xs text-[var(--warn)]">
                      <FlaskConical className="mt-0.5 size-4 shrink-0" />
                      <span>{tr('MOCK: mã OTP được cấp và điền tự động để thử nghiệm. Sau này sẽ thay bằng SMS thật.', 'MOCK: the OTP is issued and filled in automatically for testing. It will be replaced by real SMS later.')}</span>
                    </p>
                    <button type="button" className="btn btn-primary w-full" onClick={() => void requestOtp()} disabled={busy || phone.length < 9}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : tr('Tiếp tục', 'Continue')}
                    </button>
                  </>
                ) : (
                  <>
                    {mockCode && (
                      <div className="flex items-start gap-2 rounded-xl border border-[#ecd49a] bg-[#fff4d6] p-3 text-xs text-[var(--warn)]">
                        <FlaskConical className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <div className="font-semibold">{tr('MÃ OTP MOCK (chỉ môi trường phát triển)', 'MOCK OTP CODE (development only)')}</div>
                          <div className="mono mt-1 text-base tracking-[0.3em]">{mockCode}</div>
                          <button type="button" className="mt-1 underline" onClick={() => setCode(mockCode)}>
                            {tr('Điền mã này', 'Use this code')}
                          </button>
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="label" htmlFor="otp">
                        {tr('Mã OTP 6 số', '6-digit OTP')}
                      </label>
                      <input id="otp" className="field mono tracking-[0.3em]" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                    </div>
                    <button type="button" className="btn btn-primary w-full" onClick={() => void verifyOtp()} disabled={busy || code.length !== 6}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : tr('Xác minh', 'Verify')}
                    </button>
                    <button type="button" className="w-full text-xs text-[var(--muted)] underline" onClick={() => { setSent(false); setCode(''); setMockCode(null) }}>
                      {tr('Dùng số khác', 'Use another number')}
                    </button>
                  </>
                )}
              </section>
            )}

            {step === 2 && (
              <section className="card space-y-4 p-5">
                {me?.accountStatus && me.accountStatus !== 'active' && (
                  <p className="rounded-xl bg-[#fde8ec] p-3 text-xs text-[var(--danger)]">
                    {tr('Tài khoản này bị hạn chế: không thể tạo hoặc tham gia giao dịch mới, nhưng vẫn có thể xem và claim tiền của mình.', 'This account is restricted: it cannot start or join new trades, but you can still view and claim your own funds.')}
                  </p>
                )}
                <p className="text-sm text-[var(--ink-2)]">
                  {tr(
                    'Kết nối ví rồi ký một tin nhắn xác thực (EIP-4361). Thao tác này không chuyển tiền.',
                    'Connect a wallet and sign an authentication message (EIP-4361). This does not move funds.',
                  )}
                </p>
                <ConnectKitButton.Custom>
                  {({ show, isConnected: connected, truncatedAddress }) => (
                    <button type="button" className={`btn w-full ${connected ? 'btn-ghost' : 'btn-primary'}`} onClick={show}>
                      <Wallet className="size-4" /> {connected ? truncatedAddress : tr('Kết nối ví', 'Connect wallet')}
                    </button>
                  )}
                </ConnectKitButton.Custom>
                <button type="button" className="btn btn-primary w-full" onClick={() => void linkWallet()} disabled={busy || !isConnected}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : chainId !== CHAIN_ID && isConnected ? tr('Chuyển sang Arc Testnet và ký', 'Switch to Arc Testnet and sign') : tr('Ký để liên kết ví', 'Sign to link wallet')}
                </button>
                <p className="text-xs text-[var(--muted)]">
                  {tr('Cần USDC testnet để trả gas và nạp tiền: dùng nút "Get test USDC" ở thanh bên của Arc Studio.', 'You need testnet USDC for gas and funding: use the "Get test USDC" button in the Arc Studio sidebar.')}
                </p>
              </section>
            )}

            {error && (
              <p className="text-sm text-[var(--danger)]" role="alert">
                {error}
              </p>
            )}

            {!signedIn && !sent && (
              <button type="button" className="w-full text-center text-xs text-[var(--muted)] underline" onClick={() => setShowLogin(false)}>
                {tr('← Xem lại animation giao dịch mẫu', '← Watch the sample transaction animation again')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
