import { FlaskConical } from 'lucide-react'
import { useLang } from '@/i18n'

/** Shown whenever the server runs the mock OTP provider. It must never look like real phone verification. */
export function MockBanner({ otpProvider }: { otpProvider?: string }) {
  const { tr } = useLang()
  if (otpProvider !== 'mock') return null
  return (
    <div className="flex items-center justify-center gap-2 bg-[#fff4d6] px-4 py-1.5 text-center text-xs font-medium text-[var(--warn)]">
      <FlaskConical className="size-3.5 shrink-0" />
      <span>
        {tr(
          'MOCK: xác thực OTP chỉ để phát triển và testnet. Không phải xác minh số điện thoại thật.',
          'MOCK: OTP verification is for development and testnet only. This is not real phone verification.',
        )}
      </span>
    </div>
  )
}
