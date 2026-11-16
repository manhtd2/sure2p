export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

interface Options {
  method?: 'GET' | 'POST'
  body?: unknown
}

/** All calls go through the Vite /api proxy. X-Requested-With is the CSRF marker the server requires. */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST')
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string }
    throw new ApiError(res.status, d.error ?? 'error', d.message ?? `Request failed (${res.status})`)
  }
  return data as T
}

const ERROR_COPY: Record<string, [string, string]> = {
  unauthenticated: ['Vui lòng đăng nhập.', 'Please sign in.'],
  wallet_required: ['Hãy liên kết ví trước.', 'Link a wallet first.'],
  wrong_chain: ['Sai mạng. Hãy chuyển sang Arc Testnet.', 'Wrong network. Switch to Arc Testnet.'],
  rate_limited: ['Bạn thao tác quá nhanh. Thử lại sau ít phút.', 'Too many attempts. Try again in a few minutes.'],
  invalid_code: ['Mã không đúng hoặc đã hết hạn.', 'The code is wrong or expired.'],
  not_found: ['Không tìm thấy hoặc bạn không có quyền xem.', 'Not found, or you do not have access.'],
  stale_version: ['Phiên bản này đã bị thay thế. Hãy xem điều khoản mới nhất.', 'This version was replaced. Review the latest terms.'],
  wallet_in_use: ['Ví này đã liên kết với tài khoản khác.', 'This wallet is linked to another account.'],
  account_restricted: ['Tài khoản này không thể tạo hoặc tham gia giao dịch mới.', 'This account cannot start or join new trades.'],
  handover_deadline_too_soon: ['Hạn bàn giao phải cách hiện tại ít nhất 25 giờ.', 'The handover deadline must be at least 25 hours away.'],
}

export function errorText(err: unknown, tr: (vi: string, en: string) => string): string {
  if (err instanceof ApiError) {
    const known = ERROR_COPY[err.code]
    if (known) return tr(known[0], known[1])
    return err.message
  }
  if (err instanceof Error) return err.message
  return tr('Đã xảy ra lỗi.', 'Something went wrong.')
}
