import { Check, Minus, X } from 'lucide-react'
import type { CheckState, ReadinessCheck } from '@/types/ssl'
import { cn } from '@/utils/cn'

const ICON: Record<CheckState, typeof Check> = { ok: Check, fail: X, unknown: Minus }
const INK: Record<CheckState, string> = { ok: 'text-nd-success', fail: 'text-nd-error', unknown: 'text-nd-text-muted' }

interface CheckTextProps {
  check: ReadinessCheck | undefined
  fallback: string
  withIcon?: boolean
}

export function CheckText({ check, fallback, withIcon = true }: CheckTextProps) {
  if (!check) return <span className="text-[12.5px] text-nd-text-muted">—</span>
  const Icon = ICON[check.state]
  const text = check.detail || fallback
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 text-[12.5px]', INK[check.state])}>
      {withIcon && <Icon size={13} strokeWidth={2.4} className="shrink-0" aria-hidden />}
      <span className="truncate" title={text}>{text}</span>
    </span>
  )
}
