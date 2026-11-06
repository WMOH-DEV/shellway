import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { DoctorReport, SiteConfig } from '@/types/deploy'
import { readyItems, type ReadyItem } from '@/utils/deploy/readyCheck'
import { copyText } from './copyText'
import { deployApi } from './useDeploySites'

function StatusIcon({ item }: { item: ReadyItem }) {
  if (item.status === 'pass') return <Check size={13} className="mt-0.5 text-nd-success" />
  if (!item.required) return <AlertTriangle size={13} className="mt-0.5 text-nd-warning" />
  return <X size={13} className="mt-0.5 text-nd-error" />
}

function CheckRow({ item }: { item: ReadyItem }) {
  const passed = item.status === 'pass'
  return (
    <li className="flex items-start gap-2 text-xs">
      <StatusIcon item={item} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-nd-text-primary">{item.title}</span>
        {!passed && <span className="text-2xs text-nd-text-muted">{item.detail}</span>}
        {!passed && item.code && (
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-nd-bg-primary p-2 font-mono text-2xs text-nd-text-primary">{item.code}</code>
            <Button size="icon" variant="ghost" aria-label="Copy" onClick={() => void copyText(item.code ?? '')}><Copy size={13} /></Button>
          </div>
        )}
      </div>
    </li>
  )
}

export function ServerCheck({ connectionId, site }: { connectionId: string; site: SiteConfig }) {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setReport(null)
    setError(null)
    const result = await deployApi().doctor(connectionId, site.name)
    if (result.success && result.data) setReport(result.data)
    else setError(result.error ?? 'Could not check the server')
  }, [connectionId, site.name])

  useEffect(() => { void run() }, [run])

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 text-xs text-nd-error">
        {error}
        <Button size="sm" variant="ghost" onClick={() => void run()}>Try again</Button>
      </div>
    )
  }
  if (!report) return <div className="p-4 text-xs text-nd-text-muted">Checking the server…</div>

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-nd-text-secondary">Deploys run as <span className="font-mono">{report.user}</span></span>
        <Button size="sm" variant="ghost" onClick={() => void run()}>Run again</Button>
      </div>
      <ul className="flex flex-col gap-2">
        {readyItems({ site, report, access: null, publicKey: '' }).map((item) => <CheckRow key={item.id} item={item} />)}
      </ul>
    </div>
  )
}
