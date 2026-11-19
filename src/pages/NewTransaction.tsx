import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ShoppingBag, Store, Wallet } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { useSession } from '@/hooks/useSession'
import { TermsForm } from '@/components/TermsForm'
import type { DealTerms } from '@/shared/protocol'
import { uploadAttachment } from '@/lib/attachments'

export default function NewTransaction() {
  const { tr } = useLang()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { me, hasWallet } = useSession()
  const [role, setRole] = useState<'buyer' | 'seller'>('seller')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const restricted = me?.accountStatus !== undefined && me.accountStatus !== 'active'
  const needsWallet = Boolean(me?.authenticated) && !hasWallet

  async function submit(terms: DealTerms, files: File[]) {
    setBusy(true)
    setError(null)
    try {
      const { id } = await api<{ id: string }>('/drafts', { body: { role, terms } })
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      // The terms already carry each file's hash; now send the bytes. If one fails the draft page offers a retry.
      const failed: string[] = []
      for (const f of files) {
        try {
          await uploadAttachment(id, f)
        } catch {
          failed.push(f.name)
        }
      }
      if (failed.length > 0) {
        setCreatedId(id)
        setError(tr(`Đã tạo bản nháp nhưng chưa tải lên được: ${failed.join(', ')}. Mở bản nháp để tải lại.`, `The draft was created but these files did not upload: ${failed.join(', ')}. Open the draft to upload them again.`))
        return
      }
      void navigate(`/transactions/${id}`)
    } catch (e) {
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  const roles: Array<['buyer' | 'seller', string, string, typeof ShoppingBag]> = [
    ['seller', tr('Tôi là Seller', 'I am the Seller'), tr('Tôi bán hàng và nạp cọc 25%.', 'I sell and fund a 25% deposit.'), Store],
    ['buyer', tr('Tôi là Buyer', 'I am the Buyer'), tr('Tôi mua, nạp giá + cọc 25%.', 'I buy and fund price + 25% deposit.'), ShoppingBag],
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="display text-3xl font-bold">{tr('Tạo giao dịch', 'Create a transaction')}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {tr('Đây mới là bản nháp ngoài chuỗi. Chưa có khoản tiền nào bị khóa cho đến khi hai bên ký và nạp tiền.', 'This is an offchain draft. Nothing is locked until both sides sign and fund.')}
        </p>
      </div>
      {restricted && (
        <p className="rounded-xl bg-[#fde8ec] p-3 text-sm text-[var(--danger)]" role="alert">
          {tr('Tài khoản này không thể tạo giao dịch mới.', 'This account cannot create new transactions.')}
        </p>
      )}
      {needsWallet && (
        <p className="flex flex-wrap items-center gap-2 rounded-xl border border-[#ecd49a] bg-[#fff4d6] p-3 text-sm text-[var(--warn)]" role="alert">
          <Wallet className="size-4 shrink-0" />
          <span>{tr('Bạn chưa liên kết ví. Tạo giao dịch cần ví đã ký chứng minh quyền sở hữu trên Arc Testnet.', 'You have not linked a wallet yet. Creating a transaction needs a wallet that signed proof of ownership on Arc Testnet.')}</span>
          <Link className="font-semibold underline" to="/signin?next=/transactions/new">
            {tr('Liên kết ví ngay', 'Link a wallet now')}
          </Link>
        </p>
      )}
      <div className="card space-y-5 p-5">
        <TermsForm
          submitLabel={tr('Tạo bản nháp và mời đối tác', 'Create draft and invite counterparty')}
          busy={busy || restricted}
          canAttach={role === 'buyer'}
          onSubmit={(t, files) => void submit(t, files)}
          leading={
            <fieldset>
              <legend className="label">{tr('Vai trò của bạn', 'Your role')}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {roles.map(([id, title, body, Icon]) => (
                  <label key={id} className={`inner flex cursor-pointer items-start gap-3 p-3 transition-colors ${role === id ? '!border-[var(--accent)] ring-1 ring-[var(--accent)]' : ''}`}>
                    <input type="radio" name="role" className="sr-only" checked={role === id} onChange={() => setRole(id)} />
                    <Icon className="mt-0.5 size-5 shrink-0" />
                    <span>
                      <span className="block text-sm font-semibold">{title}</span>
                      <span className="block text-xs text-[var(--muted)]">{body}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          }
        />
        {error && (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {error}{' '}
            {createdId && <Link className="font-semibold underline" to={`/transactions/${createdId}`}>{tr('Mở bản nháp', 'Open the draft')}</Link>}
          </p>
        )}
      </div>
    </div>
  )
}
