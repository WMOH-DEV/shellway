import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { VerdictBadgeView } from '@/utils/ssl/hostRow'
import { VerdictBadge } from '../VerdictBadge'

interface DetailHeaderProps {
  name: string
  headline: VerdictBadgeView
  checkedAgo: string
  loading: boolean
  onBack: () => void
  onRefresh: () => void
}

export function DetailHeader({ name, headline, checkedAgo, loading, onBack, onRefresh }: DetailHeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-2.5">
      <Button size="icon" variant="ghost" aria-label="Back to hostnames" onClick={onBack}><ArrowLeft size={16} /></Button>
      <button type="button" onClick={onBack} className="text-[13px] text-nd-text-muted hover:text-nd-text-primary">SSL</button>
      <span className="text-nd-text-muted">/</span>
      <h1 className="truncate font-mono text-[17px] font-medium text-nd-text-primary">{name}</h1>
      <VerdictBadge view={headline} />
      <div className="flex-1" />
      <span className="text-xs text-nd-text-muted">checked {checkedAgo}</span>
      <Button onClick={onRefresh} disabled={loading}>
        <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Check again
      </Button>
    </header>
  )
}
