import type { Hex } from 'viem'
import { useLang } from '@/i18n'
import { useTx } from '@/hooks/useTx'
import { TxButton } from './TxButton'

interface Props {
  label: string
  /** Sends the wallet transaction and returns its hash. */
  send: () => Promise<Hex>
  /** Runs only after the receipt is confirmed successful. */
  onDone?: (hash: Hex) => unknown
  /** Runs right after broadcast, before the receipt. */
  onSubmitted?: (hash: Hex) => unknown
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  hint?: string
}

/** A self-contained wallet action with its own signature, pending and receipt states. */
export function ChainAction({ label, send, onDone, onSubmitted, variant, disabled, hint }: Props) {
  const { tr } = useLang()
  const tx = useTx(tr)
  return <TxButton label={label} state={tx.state} variant={variant} disabled={disabled} hint={hint} onClick={() => void tx.run(send, onDone, onSubmitted)} />
}
