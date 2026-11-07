import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { LogTarget } from '@/utils/server/jobs/logs'
import { serverApi } from '../../serverApi'
import { Notice } from '../../kit'

export interface LogsRequest {
  title: string
  target: LogTarget
}

export function LogsModal({ connectionId, request, onClose }: { connectionId: string; request: LogsRequest; onClose(): void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await serverApi().jobs.tail(connectionId, request.target)
    setLoading(false)
    if (!result.success) return setError(result.error)
    setError(null)
    setText(result.data)
  }, [connectionId, request.target])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Modal open onClose={onClose} title={request.title} maxWidth="max-w-3xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-nd-text-muted">Last lines of the log</span>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} />
            Refresh
          </Button>
        </div>
        {error && <Notice tone="error" title="Could not read the log">{error}</Notice>}
        {text === null && !error && (
          <div className="flex items-center gap-2 py-6 text-[13px] text-nd-text-muted">
            <Spinner size="sm" />
            Reading the log…
          </div>
        )}
        {text !== null && (
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2 font-mono text-xs leading-[1.7] text-nd-text-secondary">
            {text.trim() === '' ? 'The log is empty.' : text}
          </pre>
        )}
      </div>
    </Modal>
  )
}
