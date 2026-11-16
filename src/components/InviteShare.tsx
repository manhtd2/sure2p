import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, QrCode } from 'lucide-react'
import { useLang } from '@/i18n'
import { buildShareLink } from '@/lib/share'
import { formatDateTime } from '@/lib/format'

interface Props {
  token: string
  code: string
  expiresAt: number
}

/**
 * One invitation, three representations: link, code and QR. The bearer token travels only in the
 * #fragment so it is never sent to a server or mirrored into the address bar.
 */
export function InviteShare({ token, code, expiresAt }: Props) {
  const { tr, lang } = useLang()
  const [link, setLink] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const url = `${await buildShareLink('/join')}#${token}`
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      if (!cancelled) {
        setLink(url)
        setQr(dataUrl)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function copy(kind: 'link' | 'code', value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      // clipboard blocked: user can still select the text
    }
  }

  return (
    <div className="inner space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <QrCode className="size-4" /> {tr('Lời mời cho đối tác', 'Invitation for your counterparty')}
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="flex size-[168px] shrink-0 items-center justify-center rounded-xl bg-white p-2">
          {qr ? <img src={qr} alt={tr('Mã QR lời mời', 'Invitation QR code')} width={152} height={152} /> : <span className="text-xs text-[var(--subtle)]">...</span>}
        </div>
        <div className="w-full min-w-0 space-y-3">
          <div>
            <div className="label">{tr('Liên kết', 'Link')}</div>
            <div className="flex gap-2">
              <input readOnly value={link ?? ''} className="field mono !text-xs" aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn btn-ghost !px-3" disabled={!link} onClick={() => link && void copy('link', link)} aria-label={tr('Sao chép liên kết', 'Copy link')}>
                {copied === 'link' ? <Check className="size-4" /> : <Copy className="size-4" />}
              </button>
            </div>
          </div>
          <div>
            <div className="label">{tr('Mã nhập tay', 'Manual code')}</div>
            <div className="flex gap-2">
              <input readOnly value={code} className="field mono tracking-wider" aria-label="Invite code" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn btn-ghost !px-3" onClick={() => void copy('code', code)} aria-label={tr('Sao chép mã', 'Copy code')}>
                {copied === 'code' ? <Check className="size-4" /> : <Copy className="size-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        {tr(
          `Hết hạn lúc ${formatDateTime(expiresAt, lang)}, dùng được một lần. Quét QR chỉ mở lời mời: đối tác vẫn phải đăng nhập, liên kết ví và tự chấp nhận. Chỉ gửi cho đúng người; lời mời bị lộ có thể bị người khác nhận trước.`,
          `Expires ${formatDateTime(expiresAt, lang)}, single use. Scanning the QR only opens the invitation: your counterparty still signs in, links a wallet and accepts for themselves. Send it only to the right person; a leaked invitation can be claimed by someone else first.`,
        )}
      </p>
      <p className="text-xs text-[var(--subtle)]">
        {tr('Mã và liên kết chỉ hiển thị một lần. Nếu cần xem lại, hãy tạo lời mời mới (lời mời cũ sẽ vô hiệu).', 'The code and link are shown only once. To see them again, issue a new invitation (the old one becomes invalid).')}
      </p>
    </div>
  )
}
