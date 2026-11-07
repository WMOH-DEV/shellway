import { useMemo, useState } from 'react'
import { Radio, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ServiceLogViewer } from '@/components/services/ServiceLogViewer'
import type { LogSource } from '@/utils/server/services/logChannel'
import { logSourceKey, logSourceLabel } from '@/utils/server/services/logSources'
import { Notice } from '../../kit'
import type { ServerSectionContext } from '../types'
import { useLogStream } from './useLogStream'

function FilterInput({ value, onChange }: { value: string; onChange(value: string): void }) {
  return (
    <label className="flex h-6 items-center gap-1 rounded border border-nd-border bg-nd-bg-sunken px-1.5">
      <Search size={11} className="text-nd-text-muted" aria-hidden />
      <span className="sr-only">Show only lines that contain</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Filter lines" className="w-32 bg-transparent text-[11px] text-nd-text-primary outline-none placeholder:text-nd-text-muted" />
    </label>
  )
}

function LiveButton({ live, onStart, onStop }: { live: boolean; onStart(): void; onStop(): void }) {
  return (
    <Button variant={live ? 'primary' : 'ghost'} size="sm" onClick={live ? onStop : onStart} className="h-6 gap-1 px-2" title={live ? 'Stop the live view' : 'Show new lines as they are written'}>
      <Radio size={12} className={live ? 'animate-pulse' : undefined} />
      <span className="text-[10px]">{live ? 'Live' : 'Go live'}</span>
    </Button>
  )
}

export function LogPanel({ ctx, source, onClose }: { ctx: Pick<ServerSectionContext, 'connectionId' | 'tabId'>; source: LogSource; onClose?(): void }) {
  const stream = useLogStream(ctx, source)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = useMemo(() => (needle ? stream.entries.filter((entry) => entry.message.toLowerCase().includes(needle)) : stream.entries), [stream.entries, needle])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {stream.error && <Notice tone="error" title="Could not read this log">{stream.error}</Notice>}
      {stream.missing && <Notice tone="neutral" title="This log is not on the server">The program may not be installed, or it writes its log somewhere else.</Notice>}
      {stream.ended && <Notice tone="warning" title="Live view stopped">{stream.ended.message}</Notice>}
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-nd-border bg-nd-bg-sunken">
        <ServiceLogViewer
          connectionId={ctx.connectionId}
          unit={logSourceKey(source)}
          heading={logSourceLabel(source)}
          logs={shown}
          isLoading={stream.loading}
          onLoadLogs={(lines) => void stream.load(lines)}
          onClose={onClose}
          toolbarExtra={
            <>
              <div className="mx-0.5 h-4 w-px bg-nd-border" />
              <FilterInput value={query} onChange={setQuery} />
              <LiveButton live={stream.live} onStart={() => void stream.startLive()} onStop={stream.stopLive} />
            </>
          }
        />
      </div>
    </div>
  )
}
