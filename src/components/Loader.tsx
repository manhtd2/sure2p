import { Loader2 } from 'lucide-react'

export function Loader() {
  return (
    <div className="flex justify-center py-20 text-[var(--muted)]" role="status" aria-label="Loading">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}
