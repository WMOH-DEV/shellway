import type { ReactNode } from 'react'
import type { ProbeResult } from '@/types/server/core'
import { Spinner } from '@/components/ui/Spinner'
import { Notice } from './Notice'

export function ProbeState<T>({ result, label, children }: { result: ProbeResult<T> | undefined; label: string; children: (data: T) => ReactNode }) {
  if (!result) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-nd-text-muted">
        <Spinner size="sm" />
        Checking {label}…
      </div>
    )
  }
  if (result.status === 'unavailable') return <Notice tone="neutral" title={`${label} is unavailable`}>{result.reason}</Notice>
  if (result.status === 'error') return <Notice tone="error" title={`Could not read ${label}`}>{result.error}</Notice>
  return <>{children(result.data)}</>
}
