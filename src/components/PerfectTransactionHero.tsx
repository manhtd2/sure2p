import { useMemo } from 'react'
import { ArrowRight, Briefcase, MessageCircle, MessageSquare, Phone, Send } from 'lucide-react'
import { useLang } from '@/i18n'
import './PerfectTransactionHero.css'

/**
 * The sure2p perfect-transaction animation, recreated as a lightweight
 * CSS/SVG loop (no GSAP dependency, so the login page stays fast).
 *
 * One cycle is 29s: one full loop (~24s) — paper flies Buyer → Seller
 * trailing the dashed line, USDC Buyer → sure2p → Seller (escrow 100 USDC,
 * no deposit breakdown), Seller works with a hammer tapping stars out of
 * the hammer face, goods fly Seller → Buyer through the apps frame, Buyer
 * checks with a magnifying glass — then a 5s hold on the completed state,
 * then it repeats. Base styles are the final state, so reduced-motion
 * shows a static completed transaction.
 */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STARS = (() => {
  const rand = mulberry32(20261116)
  return Array.from({ length: 56 }, (_, i) => ({
    id: i,
    x: Math.round(rand() * 880 + 10),
    y: Math.round(rand() * 540 + 10),
    r: rand() < 0.75 ? 1.1 : 1.9,
    delay: `${(rand() * 3).toFixed(1)}s`,
    dur: `${(2.2 + rand() * 2.4).toFixed(1)}s`,
  }))
})()

const APPS = [
  { label: 'Telegram', bg: '#229ed9', Icon: Send },
  { label: 'Zalo', bg: '#0068ff', Icon: MessageCircle },
  { label: 'Messenger', bg: '#a033ff', Icon: MessageCircle },
  { label: 'Viber', bg: '#7360f2', Icon: Phone },
  { label: 'WhatsApp', bg: '#25d366', Icon: MessageSquare },
  { label: 'Chatwork', bg: '#e8442e', Icon: Briefcase },
]

function Badge({ kind, x, y }: { kind: 'lock' | 'check'; x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle r="11" fill={kind === 'check' ? '#22c55e' : '#0ea5e9'} stroke="#fff" strokeWidth="1.5" />
      <text y="4.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">
        {kind === 'check' ? '✓' : '🔒'}
      </text>
    </g>
  )
}

export default function PerfectTransactionHero({ onStartLogin, ctaVisible }: { onStartLogin: () => void; ctaVisible: boolean }) {
  const { tr } = useLang()
  const stars = useMemo(() => STARS, [])

  return (
    <section className="pt-hero" aria-label={tr('Giao dịch perfect mẫu của sure2p', 'sure2p sample perfect transaction')}>
      <svg className="pt-stage" viewBox="0 0 900 560" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="ptGradConnect" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <linearGradient id="ptGradCoin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <radialGradient id="ptNebulaA" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ptNebulaB" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Nebula wash + stars + one shooting star */}
        <g className="pt-nebula">
          <ellipse cx="170" cy="90" rx="260" ry="150" fill="url(#ptNebulaA)" />
          <ellipse cx="760" cy="140" rx="240" ry="150" fill="url(#ptNebulaB)" />
        </g>
        {stars.map((s) => (
          <circle key={s.id} className="pt-star" cx={s.x} cy={s.y} r={s.r} style={{ animationDelay: s.delay, animationDuration: s.dur }} />
        ))}
        <line className="pt-shoot" x1="820" y1="60" x2="760" y2="90" />

        {/* Buyer–Seller connection: dashed line, drawn by the paper */}
        <line className="pt-line-dashed" x1="120" y1="300" x2="780" y2="300" />
        <line className="pt-line-draw" x1="120" y1="300" x2="780" y2="300" pathLength={100} strokeDasharray="100" />

        {/* sure2p escrow node (top center) with orbit ring */}
        <g className="pt-node-escrow" transform="translate(450, 82)">
          <ellipse className="pt-orbit" rx="104" ry="58" />
          <rect x="-72" y="-32" width="144" height="64" rx="16" fill="rgba(45, 212, 191, 0.14)" stroke="#2dd4bf" strokeWidth="1.5" />
          <text className="pt-node-label" y="-2">sure2p</text>
          <text className="pt-node-sub" y="16">ESCROW</text>
          <g className="pt-lock" transform="translate(58, -24)">
            <circle r="11" fill="#0ea5e9" stroke="#fff" strokeWidth="1.5" />
            <text y="4.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">🔒</text>
          </g>
          <g className="pt-check" transform="translate(58, -24)">
            <circle r="11" fill="#22c55e" stroke="#fff" strokeWidth="1.5" />
            <text y="4.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">✓</text>
          </g>
        </g>

        {/* Escrow amount pill: 100 USDC, no deposit breakdown */}
        <g className="pt-escrow-pill" transform="translate(450, 148)">
          <rect x="-52" y="-15" width="104" height="30" rx="15" fill="rgba(45, 212, 191, 0.16)" stroke="#2dd4bf" strokeWidth="1.2" />
          <text y="5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#a7f3d0">100 USDC</text>
        </g>

        {/* Buyer node (cyan) */}
        <g className="pt-node" transform="translate(120, 300)">
          <circle r="46" fill="rgba(34, 211, 238, 0.14)" stroke="#22d3ee" strokeWidth="1.5" />
          <text className="pt-node-label" y="5">Buyer</text>
          <g className="pt-lock" transform="translate(34, -34)"><Badge kind="lock" x={0} y={0} /></g>
          <g className="pt-check" transform="translate(34, -34)"><Badge kind="check" x={0} y={0} /></g>
        </g>

        {/* Seller node (purple) */}
        <g className="pt-node-seller" transform="translate(780, 300)">
          <circle r="46" fill="rgba(168, 85, 247, 0.16)" stroke="#a855f7" strokeWidth="1.5" />
          <text className="pt-node-label" y="5">Seller</text>
          <g className="pt-seller-lock" transform="translate(34, -34)"><Badge kind="lock" x={0} y={0} /></g>
          <g className="pt-seller-check" transform="translate(34, -34)"><Badge kind="check" x={0} y={0} /></g>
        </g>

        {/* Seller working: hammer taps, stars burst from the hammer face */}
        <g className="pt-hammer" transform="translate(688, 196)">
          <g className="pt-hammer-tap">
            <line x1="-16" y1="16" x2="4" y2="-4" stroke="#e2e8f0" strokeWidth="5" strokeLinecap="round" />
            <path d="M-4 -14 L14 -16 L16 -4 L0 -2 Z" fill="#f1f5f9" stroke="#94a3b8" strokeWidth="1" />
            <path d="M-4 -14 L-12 -18" stroke="#f1f5f9" strokeWidth="4" strokeLinecap="round" />
          </g>
          <g transform="translate(16, -9)">
            <path className="pt-hammer-star" style={{ '--dx': '10px', '--dy': '-12px' } as React.CSSProperties} d="M0 -6 L1.8 -1.8 L6 0 L1.8 1.8 L0 6 L-1.8 1.8 L-6 0 L-1.8 -1.8 Z" fill="#fde047" />
            <path className="pt-hammer-star" style={{ '--dx': '-10px', '--dy': '-14px' } as React.CSSProperties} d="M0 -5 L1.5 -1.5 L5 0 L1.5 1.5 L0 5 L-1.5 1.5 L-5 0 L-1.5 -1.5 Z" fill="#fff" />
            <path className="pt-hammer-star" style={{ '--dx': '14px', '--dy': '4px' } as React.CSSProperties} d="M0 -5 L1.5 -1.5 L5 0 L1.5 1.5 L0 5 L-1.5 1.5 L-5 0 L-1.5 -1.5 Z" fill="#f9a8d4" />
            <path className="pt-hammer-star" style={{ '--dx': '-4px', '--dy': '10px' } as React.CSSProperties} d="M0 -5 L1.5 -1.5 L5 0 L1.5 1.5 L0 5 L-1.5 1.5 L-5 0 L-1.5 -1.5 Z" fill="#67e8f9" />
          </g>
        </g>

        {/* Buyer checking: magnifier orbits one spot, handle keeps its direction */}
        <g className="pt-lens" transform="translate(178, 232)">
          <g className="pt-lens-orbit">
            <circle r="12" fill="rgba(255, 255, 255, 0.14)" stroke="#fff" strokeWidth="2" />
            <line x1="9" y1="9" x2="18" y2="18" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          </g>
        </g>

        {/* Flying items */}
        <g className="pt-paper">
          <rect x="-13" y="-17" width="26" height="34" rx="3" fill="#fff" stroke="#cbd5e1" />
          <path d="M13 -17 L5 -9 L13 -9 Z" fill="#e2e8f0" />
          <line x1="-8" y1="-2" x2="8" y2="-2" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="-8" y1="4" x2="8" y2="4" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="-8" y1="10" x2="4" y2="10" stroke="#94a3b8" strokeWidth="1.5" />
        </g>

        <g className="pt-coin">
          <circle r="15" fill="url(#ptGradCoin)" stroke="#bfdbfe" strokeWidth="1.5" />
          <text y="5.5" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">$</text>
        </g>

        <g className="pt-goods">
          <rect x="-16" y="-13" width="32" height="26" rx="4" fill="#a855f7" stroke="#e9d5ff" strokeWidth="1.5" />
          <line x1="0" y1="-13" x2="0" y2="13" stroke="#e9d5ff" strokeWidth="2" />
          <line x1="-16" y1="0" x2="16" y2="0" stroke="#e9d5ff" strokeWidth="1" opacity="0.7" />
        </g>
      </svg>

      {/* Apps frame: icon-only, appears only while the goods pass through */}
      <div className="pt-apps" style={{ position: 'absolute', left: '50%', top: '76%', transform: 'translateX(-50%)' }} aria-hidden="true">
        <div className="pt-apps-frame">
          {APPS.map(({ label, bg, Icon }) => (
            <span key={label} className="pt-app-icon" style={{ background: bg }} title={label} aria-label={label}>
              <Icon className="size-4" />
            </span>
          ))}
        </div>
      </div>

      {ctaVisible && (
        <div className="pt-hero-copy">
          <span className="pt-hero-badge">{tr('Giao dịch perfect · Arc Testnet', 'Perfect transaction · Arc Testnet')}</span>
          <div className="pt-hero-title">{tr('Giao dịch an toàn, tiền chỉ đi khi cả hai cùng xác nhận', 'Safe trades — money only moves when both sides confirm')}</div>
          <p className="pt-hero-sub">{tr('Xem một giao dịch mẫu chạy hết một vòng, rồi đăng nhập để bắt đầu.', 'Watch one sample transaction run a full loop, then sign in to start.')}</p>
          <button type="button" className="pt-cta" onClick={onStartLogin}>
            {tr('Đăng nhập', 'Sign in')} <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </section>
  )
}
