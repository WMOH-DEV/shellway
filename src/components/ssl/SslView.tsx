import { useEffect, useState } from 'react'
import { useHttpsIntentStore } from '@/stores/httpsIntentStore'
import { useSessionStore } from '@/stores/sessionStore'
import type { ConnectionStatus } from '@/types/session'
import { HostnameDetail } from './HostnameDetail'
import { AddHttpsWizard } from './https/AddHttpsWizard'
import { useCertbotRun } from './detail/useCertbotRun'
import { HostnamesScreen } from './HostnamesScreen'
import { ErrorState, LoadingState } from './LoadState'
import { SslSettings } from './settings/SslSettings'
import { useNowSeconds } from './useNowSeconds'
import { useSslReport } from './useSslReport'

interface SslViewProps {
  connectionId: string
  sessionId: string
  connectionStatus: ConnectionStatus
}

type Screen = { kind: 'list' } | { kind: 'detail'; name: string } | { kind: 'settings' } | { kind: 'add-https'; blockId?: string }

export function SslView({ connectionId, sessionId, connectionStatus }: SslViewProps) {
  const connected = connectionStatus === 'connected'
  const { report, loading, error, refresh } = useSslReport(connectionId, sessionId, connected)
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const now = useNowSeconds()
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))
  const backToList = () => setScreen({ kind: 'list' })
  const recheck = () => void refresh()
  const run = useCertbotRun(connectionId, recheck)
  const requestedBlockId = useHttpsIntentStore((s) => s.pending[connectionId])
  const consumeIntent = useHttpsIntentStore((s) => s.consume)
  const addHttps = (blockId?: string) => setScreen({ kind: 'add-https', blockId })

  useEffect(() => {
    if (requestedBlockId === undefined) return
    consumeIntent(connectionId)
    setScreen({ kind: 'add-https', blockId: requestedBlockId })
  }, [requestedBlockId, connectionId, consumeIntent])

  if (!connected) {
    return <div className="flex h-full items-center justify-center bg-nd-bg-primary text-sm text-nd-text-muted">Connect to this server to check its certificates</div>
  }

  if (screen.kind === 'settings') {
    return <SslSettings connectionId={connectionId} report={report} checking={loading} onBack={backToList} onRecheck={recheck} onCloudflareChanged={recheck} />
  }

  if (!report) return error ? <ErrorState message={error} retrying={loading} onRetry={recheck} /> : <LoadingState />

  if (screen.kind === 'add-https') {
    return (
      <AddHttpsWizard
        key={screen.blockId ?? 'new'}
        connectionId={connectionId}
        sessionId={sessionId}
        serverName={session?.name ?? 'this server'}
        report={report}
        blockId={screen.blockId ?? null}
        onCancel={backToList}
        onFinished={() => { recheck(); backToList() }}
      />
    )
  }

  const detailHost = screen.kind === 'detail' ? report.hostnames.find((h) => h.name === screen.name) : undefined
  if (detailHost) {
    return (
      <HostnameDetail
        key={detailHost.name}
        host={detailHost}
        report={report}
        now={now}
        loading={loading}
        error={error}
        run={run}
        onBack={backToList}
        onAddHttps={addHttps}
        onRefresh={refresh}
      />
    )
  }

  return (
    <HostnamesScreen
      report={report}
      serverName={session?.name ?? 'this server'}
      now={now}
      loading={loading}
      error={error}
      onRefresh={recheck}
      onOpen={(name) => setScreen({ kind: 'detail', name })}
      onOpenSettings={() => setScreen({ kind: 'settings' })}
      onAddHttps={addHttps}
    />
  )
}
