import type { ConnectionStatus } from '@/types/session'

interface SslViewProps {
  connectionId: string
  sessionId: string
  connectionStatus: ConnectionStatus
}

export function SslView({ connectionStatus }: SslViewProps) {
  const connected = connectionStatus === 'connected'
  return (
    <div className="flex h-full items-center justify-center bg-nd-bg-primary text-sm text-nd-text-muted">
      {connected ? 'SSL' : 'Connect to this server to check its certificates'}
    </div>
  )
}
