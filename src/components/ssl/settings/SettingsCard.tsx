import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/utils/cn'
import type { ChipTone } from '@/utils/ssl/settingsPermissions'

export function SettingsCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3.5 rounded-xl border border-nd-border bg-nd-bg-secondary p-[18px]">
      {children}
    </section>
  )
}

export function CardHeading({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      {icon}
      <h2 className="text-[15px] font-semibold text-nd-text-primary">{title}</h2>
      {children}
    </div>
  )
}

const TONE_VARIANT = { success: 'success', warning: 'warning', error: 'error', neutral: 'default' } as const

export function StatusChip({ tone, children, className }: { tone: ChipTone; children: ReactNode; className?: string }) {
  return (
    <Badge variant={TONE_VARIANT[tone]} className={cn(tone === 'neutral' && 'bg-nd-bg-tertiary', className)}>
      {children}
    </Badge>
  )
}

export function LoadingLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-nd-text-muted">
      <Spinner size="sm" />
      {text}
    </div>
  )
}

export function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 text-xs text-nd-error">
      {message}
      <Button size="sm" variant="ghost" onClick={onRetry}>Try again</Button>
    </div>
  )
}
