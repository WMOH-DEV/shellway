import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

interface WizardFrameProps {
  subtitle: string
  onBack: () => void
  aside?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export function WizardFrame({ subtitle, onBack, aside, footer, children }: WizardFrameProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2.5 border-b border-nd-border px-7 py-4">
        <Button size="icon" variant="ghost" aria-label="Back to sites" onClick={onBack}><ArrowLeft size={16} /></Button>
        <h1 className="text-lg font-semibold text-nd-text-primary">Create site</h1>
        <span className="text-sm text-nd-text-muted">{subtitle}</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="flex min-h-full items-stretch gap-8 px-7 py-6">
          {aside && <aside className="flex w-[260px] shrink-0 flex-col gap-5">{aside}</aside>}
          <main className={cn('flex min-w-0 max-w-3xl flex-1 flex-col', !aside && 'mx-auto')}>{children}</main>
        </div>
      </div>
      {footer && (
        <footer className="flex flex-wrap items-center gap-2.5 border-t border-nd-border bg-nd-bg-secondary px-7 py-3">{footer}</footer>
      )}
    </div>
  )
}
