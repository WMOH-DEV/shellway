import { WifiOff, ExternalLink, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface DisconnectedSessionViewProps {
  sessionName: string
  sessionHost?: string
  sessionPort?: number
  sessionUsername?: string
  sessionColor?: string
  error?: string
  onConnect: () => void
}

/**
 * Premium disconnected session view — shown when a session is selected but not connected,
 * or when an active connection drops. Centered SVG icon with session info and connect button.
 */
export function DisconnectedSessionView({
  sessionName,
  sessionHost,
  sessionPort,
  sessionUsername,
  sessionColor,
  error,
  onConnect
}: DisconnectedSessionViewProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 animate-fade-in select-none">
      {/* Decorative icon with glow */}
      <div className="relative mb-8">
        {/* Background glow */}
        <div className="absolute -inset-8 rounded-full bg-nd-accent/[0.03] blur-2xl" />

        {/* Icon container */}
        <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-nd-bg-tertiary to-nd-surface border border-nd-border/50 flex items-center justify-center shadow-2xl shadow-black/20">
          {/* Subtle inner ring */}
          <div className="absolute inset-1.5 rounded-[18px] border border-nd-border/20" />
          <WifiOff size={40} className="text-nd-text-muted/40" />
        </div>

        {/* Status dot */}
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-nd-bg-primary border-2 border-nd-border flex items-center justify-center">
          <div className="w-2.5 h-2.5 rounded-full bg-nd-text-muted/30" />
        </div>
      </div>

      {/* Session info */}
      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="w-3 h-3 rounded-full shrink-0 opacity-50"
          style={{ backgroundColor: sessionColor || '#71717a' }}
        />
        <h2 className="text-xl font-semibold text-nd-text-primary">
          {sessionName}
        </h2>
      </div>

      {sessionHost && (
        <p className="text-sm text-nd-text-muted font-mono mb-1">
          {sessionUsername && `${sessionUsername}@`}
          {sessionHost}
          {sessionPort && sessionPort !== 22 ? `:${sessionPort}` : ''}
        </p>
      )}

      <p className="text-xs text-nd-text-muted/50 mb-8 tracking-wide uppercase font-medium">
        Session Offline
      </p>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-nd-error/10 border border-nd-error/20 mb-6 max-w-sm">
          <AlertCircle size={15} className="text-nd-error/70 shrink-0 mt-0.5" />
          <p className="text-xs text-nd-error/70 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Connect button */}
      <Button
        variant="primary"
        size="lg"
        onClick={onConnect}
        className="shadow-lg shadow-nd-accent/20 hover:shadow-nd-accent/30 transition-all"
      >
        <ExternalLink size={16} />
        Connect
      </Button>
    </div>
  )
}
