import { useLang } from '@/i18n'
import type { ListItem } from '@/lib/types'

const DRAFT_LABEL: Record<string, [string, string]> = {
  draft: ['Bản nháp', 'Draft'],
  invited: ['Đã mời, chờ đối tác', 'Invited, waiting'],
  negotiating: ['Đang đàm phán', 'Negotiating'],
  ready: ['Đã ký, chờ tạo escrow', 'Signed, create escrow'],
  submitted: ['Đang lập chỉ mục', 'Awaiting indexing'],
  escrow_created: ['Đã tạo escrow', 'Escrow created'],
}

const STAGE_LABEL: Record<string, [string, string]> = {
  funding: ['Đang nạp tiền', 'Funding'],
  active: ['Đang hoạt động', 'Active'],
  overdue: ['Quá hạn, đã khóa', 'Overdue, locked'],
  disputed: ['Tranh chấp, đã khóa', 'Disputed, locked'],
  preliminary_ruling: ['Phán quyết sơ bộ, chờ kháng cáo', 'Preliminary ruling, appeal open'],
  appealed: ['Đang xét kháng cáo', 'Appeal under review'],
  ruled: ['Đã phán quyết', 'Ruled'],
  completed: ['Hoàn tất', 'Completed'],
  settled: ['Đã dàn xếp', 'Settled'],
  expired_unfunded: ['Hết hạn nạp tiền', 'Expired unfunded'],
}

const TONE: Record<string, string> = {
  active: '!bg-[#e3f4ea] !text-[var(--success)]',
  completed: '!bg-[#e3f4ea] !text-[var(--success)]',
  settled: '!bg-[#e3f4ea] !text-[var(--success)]',
  ruled: '!bg-[#e3f4ea] !text-[var(--success)]',
  preliminary_ruling: '!bg-[#fff4d6] !text-[var(--warn)]',
  appealed: '!bg-[#fde8ec] !text-[var(--danger)]',
  overdue: '!bg-[#fff4d6] !text-[var(--warn)]',
  disputed: '!bg-[#fde8ec] !text-[var(--danger)]',
}

export function StageChip({ item }: { item: ListItem }) {
  const { tr } = useLang()
  const key = item.kind === 'draft' ? item.status : item.stage
  const labels = (item.kind === 'draft' ? DRAFT_LABEL : STAGE_LABEL)[key]
  return <span className={`chip ${TONE[key] ?? ''}`}>{labels ? tr(labels[0], labels[1]) : key}</span>
}

export function StageLabel({ stage }: { stage: string }) {
  const { tr } = useLang()
  const labels = STAGE_LABEL[stage]
  return <span className={`chip ${TONE[stage] ?? ''}`}>{labels ? tr(labels[0], labels[1]) : stage}</span>
}
