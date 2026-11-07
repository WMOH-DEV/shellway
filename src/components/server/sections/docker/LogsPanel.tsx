import { useEffect, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Toggle } from '@/components/ui/Toggle'
import { Spinner } from '@/components/ui/Spinner'
import { SidePanel } from './SidePanel'
import { useContainerLogs } from './useContainerLogs'

export function LogsPanel({ connectionId, tabId, container, onClose }: { connectionId: string; tabId: string; container: string; onClose(): void }) {
  const [follow, setFollow] = useState(true)
  const [nonce, setNonce] = useState(0)
  const logs = useContainerLogs(connectionId, tabId, container, follow, nonce)
  const box = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [logs.text, follow])

  const reload = (
    <button type="button" aria-label="Reload logs" onClick={() => setNonce((value) => value + 1)} className="rounded-md p-1.5 text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
      <RotateCw size={15} />
    </button>
  )

  return (
    <SidePanel title={<>Logs · <span className="font-mono">{container}</span></>} label={`Logs for ${container}`} aside={reload} onClose={onClose}>
      <div className="flex items-center gap-3 text-xs text-nd-text-muted">
        <Toggle checked={follow} onChange={setFollow} label="Follow new lines" />
        <div className="flex-1" />
        {logs.running ? <span className="inline-flex items-center gap-1.5"><Spinner size="sm" />{follow ? 'Following' : 'Loading'}</span> : <span>Last 200 lines</span>}
      </div>
      {logs.notice && <p className="text-xs text-nd-warning-fg">{logs.notice}</p>}
      <pre ref={box} className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2 font-mono text-xs leading-[1.7] text-nd-text-secondary">
        {logs.text || (logs.running ? '' : 'No output.')}
      </pre>
    </SidePanel>
  )
}
