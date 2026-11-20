import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWriteContract } from 'wagmi'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { CHAIN_ID } from '@/lib/contracts'
import { shortAddress } from '@/lib/format'
import { registryAbi } from '@/shared/registryAbi'
import { ChainAction } from '@/components/ChainAction'
import { Loader } from '@/components/Loader'
import type { AdminMe } from '../Admin'

interface Item {
  publicId: string
  side: 'buyer' | 'seller'
  wallet: string
  accountStatus: string | null
  phoneMasked: string | null
  registryBanned: boolean
}

const REGISTRY = (import.meta.env.VITE_ACCOUNT_REGISTRY_ADDRESS ?? '') as `0x${string}`

/**
 * Account bans. Only wallets the CONTRACT names as fraudulent in a FINAL ruling appear here, and only the registry
 * security admin can act. A ban stops new deals; it never freezes a wallet or touches existing deals and claims.
 */
export default function AdminAccounts() {
  const { tr } = useLang()
  const me = useOutletContext<AdminMe>()
  const qc = useQueryClient()
  const { writeContractAsync } = useWriteContract()
  const [error, setError] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['admin-accounts'], queryFn: () => api<{ security: boolean; items: Item[] }>('/admin/accounts'), refetchInterval: 15_000 })
  if (q.isLoading || !q.data) return <Loader />
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-accounts'] })
  async function setStatus(i: Item, action: 'ban' | 'unban') {
    setError(null)
    try {
      await api(`/admin/accounts?action=${action}`, { body: { publicId: i.publicId, side: i.side } })
      refresh()
    } catch (e) {
      setError(errorText(e, tr))
    }
  }
  return (
    <div className="space-y-5">
      <h1 className="display text-3xl font-bold">{tr('Tài khoản bị xác nhận gian lận', 'Accounts with confirmed fraud')}</h1>
      <p className="text-sm text-[var(--ink-2)]">
        {tr(
          'Chỉ hiện các bên mà hợp đồng ghi là gian lận trong một phán quyết cuối cùng. Cấm chỉ chặn mở hoặc tham gia giao dịch mới; không đóng băng ví và không chạm vào giao dịch cũ hay tiền chờ nhận.',
          'Only parties the contract names as fraudulent in a FINAL ruling appear. A ban only blocks opening or joining new deals; it never freezes a wallet or touches old deals or pending claims.',
        )}
      </p>
      {!me.security && (
        <p className="rounded-xl bg-[#fff4d6] p-3 text-sm text-[var(--warn)]">
          {tr('Ví của bạn không giữ SECURITY_ROLE của sổ đăng ký nên chỉ xem được. Chỉ quản trị bảo mật mới cấm hoặc bỏ cấm.', 'Your wallet does not hold the registry SECURITY_ROLE, so this page is read-only. Only the security admin can ban or unban.')}
        </p>
      )}
      {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}
      {q.data.items.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--muted)]">{tr('Chưa có phán quyết cuối nào xác nhận gian lận.', 'No final ruling has confirmed fraud yet.')}</p>
      ) : (
        <ul className="space-y-3">
          {q.data.items.map((i) => (
            <li key={`${i.publicId}-${i.side}`} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{i.side === 'buyer' ? 'Buyer' : 'Seller'} · <span className="mono text-xs">{i.publicId}</span></p>
                  <p className="mono text-xs text-[var(--muted)]">{shortAddress(i.wallet)} · {i.phoneMasked ?? tr('chưa liên kết tài khoản', 'no linked account')}</p>
                </div>
                <div className="flex gap-2">
                  <span className="chip">{tr('Tài khoản', 'Account')}: {i.accountStatus ?? '—'}</span>
                  <span className="chip">{tr('Sổ đăng ký', 'Registry')}: {i.registryBanned ? tr('đã cấm ví', 'wallet banned') : tr('chưa cấm', 'not banned')}</span>
                </div>
              </div>
              {me.security && (
                <div className="flex flex-wrap gap-2">
                  {i.accountStatus !== 'banned' ? (
                    <button type="button" className="btn btn-danger" onClick={() => void setStatus(i, 'ban')}>{tr('Cấm mở giao dịch mới (tài khoản)', 'Ban new deals (account)')}</button>
                  ) : (
                    <button type="button" className="btn btn-ghost" onClick={() => void setStatus(i, 'unban')}>{tr('Bỏ cấm tài khoản', 'Lift account ban')}</button>
                  )}
                  <ChainAction
                    label={i.registryBanned ? tr('Bỏ cấm ví trong sổ đăng ký', 'Unban wallet in registry') : tr('Ghi cấm ví vào sổ đăng ký', 'Ban wallet in registry')}
                    send={() => writeContractAsync({ address: REGISTRY, abi: registryAbi, functionName: 'setBanned', args: [i.wallet as `0x${string}`, !i.registryBanned], chainId: CHAIN_ID })}
                    onDone={refresh}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
