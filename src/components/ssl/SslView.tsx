import { useState } from 'react'
import { useSessionStore } from '@/stores/sessionStore'
import type { ConnectionStatus } from '@/types/session'
import { HostnameDetail } from './HostnameDetail'
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

type Screen = { kind: 'list' } | { kind: 'detail'; name: string } | { kind: 'settings' }

export function SslView({ connectionId, sessionId, connectionStatus }: SslViewProps) {
  const connected = connectionStatus === 'connected'
  const { report, loading, error, refresh } = useSslReport(connectionId, sessionId, connected)
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const now = useNowSeconds()
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))
  const backToList = () => setScreen({ kind: 'list' })
  const recheck = () => void refresh()

  if (!connected) {
    return <div className="flex h-full items-center justify-center bg-nd-bg-primary text-sm text-nd-text-muted">Connect to this server to check its certificates</div>
  }

  if (screen.kind === 'settings') {
    return <SslSettings connectionId={connectionId} report={report} onBack={backToList} onRecheck={recheck} onCloudflareChanged={recheck} />
  }

  if (!report) return error ? <ErrorState message={error} retrying={loading} onRetry={recheck} /> : <LoadingState />

  const detailHost = screen.kind === 'detail' ? report.hostnames.find((h) => h.name === screen.name) : undefined
  if (detailHost) {
    return (
      <HostnameDetail
        key={detailHost.name}
        connectionId={connectionId}
        host={detailHost}
        report={report}
        now={now}
        loading={loading}
        error={error}
        onBack={backToList}
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
    />
  )
}
