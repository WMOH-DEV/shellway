import { AlertTriangle, Check, X } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/utils/cn'
import type { ReadyItem } from '@/utils/deploy/readyCheck'
import type { DeployKey } from '../useDeployKey'
import { CodeBox } from './CodeBox'
import { KeyActions } from './KeyActions'

interface ReadyItemRowProps {
  item: ReadyItem
  deployKey: DeployKey
}

function StatusDot({ item }: { item: ReadyItem }) {
  const tone = item.status === 'pass' ? 'bg-nd-success/12 text-nd-success-fg' : item.required ? 'bg-nd-error/12 text-nd-error-fg' : 'bg-nd-warning/12 text-nd-warning-fg'
  const Icon = item.status === 'pass' ? Check : item.required ? X : AlertTriangle
  return (
    <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', tone)}>
      {item.status === 'checking' ? <Spinner size="sm" /> : <Icon size={12} strokeWidth={2.6} />}
    </span>
  )
}

function CompactRow({ item }: { item: ReadyItem }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <StatusDot item={item} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-nd-text-primary">{item.title}</span>
      <span className="min-w-0 max-w-[45%] truncate font-mono text-xs text-nd-text-muted">{item.detail}</span>
    </div>
  )
}

function ExpandedRow({ item, deployKey }: ReadyItemRowProps) {
  const needsKeyActions = item.actions.includes('test-access')
  return (
    <div className="flex flex-col gap-3 bg-nd-bg-primary/40 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <StatusDot item={item} />
        <span className="min-w-0 flex-1 text-[13px] font-medium text-nd-text-primary">{item.title}</span>
        <span className={cn('text-xs', item.required ? 'text-nd-error-fg' : 'text-nd-warning-fg')}>{item.required ? 'Required' : 'Recommended'}</span>
      </div>
      <div className="flex flex-col gap-2.5 pl-[34px]">
        <span className="text-xs text-nd-text-secondary">{item.detail}</span>
        {item.code && <CodeBox code={item.code} copyable={item.actions.includes('copy')} />}
        {needsKeyActions && <KeyActions deployKey={deployKey} actions={item.actions} />}
      </div>
    </div>
  )
}

export function ReadyItemRow({ item, deployKey }: ReadyItemRowProps) {
  return item.status === 'fail' ? <ExpandedRow item={item} deployKey={deployKey} /> : <CompactRow item={item} />
}
