import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { CHIP_TONE, DOT_TONE, type KitTone } from './tones'

export function Chip({ tone = 'neutral', dense, dot, mono, children }: { tone?: KitTone; dense?: boolean; dot?: boolean; mono?: boolean; children: ReactNode }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium', dense ? 'h-5 rounded-[5px] px-[7px] text-[11px]' : 'h-[22px] rounded-md px-2 text-xs', mono && 'font-mono', CHIP_TONE[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

export function StatusDot({ tone, label }: { tone: KitTone; label?: string }) {
  return <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('inline-block h-[7px] w-[7px] shrink-0 rounded-full', DOT_TONE[tone])} />
}
