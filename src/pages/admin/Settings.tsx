import { useQuery } from '@tanstack/react-query'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { shortAddress } from '@/lib/format'
import { Loader } from '@/components/Loader'

interface Trust {
  contracts: { escrow: string; registry: string }
  roles?: { owner: string; arbiter: string; appealReviewer: string; penaltyWallet: string; penaltyEqualsOwner: boolean }
}

/** Role configuration, read only. Changing a role is a transaction from the owner wallet, made outside this screen. */
export default function AdminSettings() {
  const { tr } = useLang()
  const q = useQuery({ queryKey: ['trust'], queryFn: () => api<Trust>('/trust') })
  if (q.isLoading || !q.data) return <Loader />
  const r = q.data.roles
  const a = (x: string) => <a className="mono underline" href={`https://explorer.testnet.arc.io/address/${x}`} target="_blank" rel="noreferrer">{shortAddress(x)}</a>
  return (
    <div className="space-y-5">
      <h1 className="display text-3xl font-bold">{tr('Cài đặt', 'Settings')}</h1>
      <section className="card space-y-2 p-5 text-sm">
        <h2 className="display text-lg font-bold">{tr('Vai trò trên chuỗi (chỉ đọc)', 'Onchain roles (read only)')}</h2>
        {r ? (
          <ul className="space-y-1">
            <li>owner: {a(r.owner)}</li>
            <li>{tr('Người phán quyết', 'Arbiter')}: {a(r.arbiter)}</li>
            <li>{tr('Người xem xét kháng cáo', 'Appeal reviewer')}: {a(r.appealReviewer)}</li>
            <li>{tr('Ví phạt (cố định)', 'Penalty wallet (fixed)')}: {a(r.penaltyWallet)}</li>
            <li>{tr('Hợp đồng ký quỹ', 'Escrow contract')}: {a(q.data.contracts.escrow)}</li>
            <li>{tr('Sổ đăng ký tài khoản', 'Account registry')}: {a(q.data.contracts.registry)}</li>
          </ul>
        ) : (
          <p className="text-[var(--muted)]">{tr('Chưa rõ: không đọc được chuỗi.', 'Unknown: the chain could not be read.')}</p>
        )}
        {r?.penaltyEqualsOwner && (
          <p className="rounded-xl bg-[#fff4d6] p-3 text-[var(--warn)]">
            {tr('Ví owner trùng ví phạt. Đây là ngoại lệ có chủ đích, đã ghi trong tài liệu quyết định.', 'The owner equals the penalty wallet. This is a deliberate exception recorded in the decisions log.')}
          </p>
        )}
      </section>
      <section className="card space-y-2 p-5 text-sm text-[var(--ink-2)]">
        <h2 className="display text-lg font-bold">{tr('Cách đổi vai trò', 'How to change a role')}</h2>
        <p>{tr('Owner gọi setArbiter hoặc setAppealReviewer từ ví của owner, bên ngoài màn hình này. Owner không thể phán quyết hay chuyển tiền. Chuyển quyền owner qua hai bước (transferOwnership rồi acceptOwnership), có thể sang ví Safe nhiều chữ ký.', 'The owner calls setArbiter or setAppealReviewer from the owner wallet, outside this screen. The owner cannot rule or move funds. Ownership moves in two steps (transferOwnership then acceptOwnership) and may go to a multisig Safe.')}</p>
        <p>{tr('Vai trò quản trị bảo mật (cấm ví) nằm trong sổ đăng ký, do người giữ SECURITY_ROLE quản lý.', 'The security admin role (wallet bans) lives in the registry and is managed by the SECURITY_ROLE holder.')}</p>
      </section>
    </div>
  )
}
