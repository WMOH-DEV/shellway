import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Pause, Play, RotateCw, Unplug } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore, type ReconnectionTabState } from '@/stores/connectionStore'
import { Button } from '@/components/ui/Button'

interface ReconnectionOverlayProps {
  connectionId: string
  onRetryNow: () => void
  onPause: () => void
  onResume: () => void
  onDisconnect: () => void
}

/**
 * Overlay displayed on a connection tab when reconnecting.
 * Shows reconnection status, countdown, mini event log, and action buttons.
 */
export function ReconnectionOverlay({
  connectionId,
  onRetryNow,
  onPause,
  onResume,
  onDisconnect
}: ReconnectionOverlayProps) {
  const reconnectionState = useConnectionStore(
    (s) => s.reconnectionState.get(connectionId)
  )

  // If no reconnection state or idle, don't render
  if (!reconnectionState || reconnectionState.state === 'idle') {
    return null
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 z-30 flex items-center justify-center bg-nd-bg-primary/80 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-md mx-4 rounded-lg border border-nd-border bg-nd-bg-secondary shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex flex-col items-center gap-3 px-6 pt-6 pb-4">
            <PulsingIndicator state={reconnectionState.state} />

            <h2 className="text-sm font-semibold text-nd-text-primary">
              {reconnectionState.state === 'paused'
                ? 'Reconnection Paused'
                : 'Connection Lost — Reconnecting...'}
            </h2>

            {/* Attempt counter */}
            <div className="text-xs text-nd-text-secondary">
              Attempt{' '}
              <span className="text-nd-text-primary font-medium">
                {reconnectionState.attempt}
              </span>{' '}
              of{' '}
              <span className="text-nd-text-primary font-medium">
                {reconnectionState.maxAttempts === 0 ? '\u221E' : reconnectionState.maxAttempts}
              </span>
            </div>

            {/* Countdown timer */}
            {reconnectionState.state === 'waiting' && reconnectionState.nextRetryAt && (
              <CountdownTimer targetTime={reconnectionState.nextRetryAt} />
            )}
          </div>

          {/* Mini event log */}
          {reconnectionState.recentEvents.length > 0 && (
            <div className="mx-4 mb-4 max-h-[160px] overflow-y-auto rounded border border-nd-border/50 bg-nd-bg-primary">
              {reconnectionState.recentEvents.map((event, i) => (
                <div
                  key={i}
                  className={cn(
                    'px-3 py-1 text-2xs font-mono text-nd-text-secondary',
                    i < reconnectionState.recentEvents.length - 1 && 'border-b border-nd-border/30'
                  )}
                >
                  {event}
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-2 px-6 pb-5">
            <Button variant="primary" size="sm" onClick={onRetryNow}>
              <RotateCw size={13} />
              Retry Now
            </Button>

            {reconnectionState.state === 'paused' ? (
              <Button variant="secondary" size="sm" onClick={onResume}>
                <Play size={13} />
                Resume Retrying
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onPause}>
                <Pause size={13} />
                Pause Retrying
              </Button>
            )}

            <Button variant="danger" size="sm" onClick={onDisconnect}>
              <Unplug size={13} />
              Disconnect
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

/** Pulsing / spinning indicator based on reconnection state */
function PulsingIndicator({ state }: { state: ReconnectionTabState['state'] }) {
  if (state === 'paused') {
    return (
      <div className="flex items-center justify-center h-10 w-10 rounded-full bg-nd-text-muted/10">
        <Pause size={20} className="text-nd-text-muted" />
      </div>
    )
  }

  if (state === 'attempting') {
    return (
      <div className="flex items-center justify-center h-10 w-10 rounded-full bg-nd-warning/10">
        <Loader2 size={20} className="text-nd-warning animate-spin" />
      </div>
    )
  }

  // 'waiting' state — pulsing ring
  return (
    <div className="relative flex items-center justify-center h-10 w-10">
      <span className="absolute inset-0 rounded-full bg-nd-warning/20 animate-ping" />
      <span className="relative flex items-center justify-center h-10 w-10 rounded-full bg-nd-warning/10">
        <Loader2 size={20} className="text-nd-warning animate-spin" />
      </span>
    </div>
  )
}

/** Live countdown timer showing seconds until next retry */
function CountdownTimer({ targetTime }: { targetTime: number }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((targetTime - Date.now()) / 1000))
  )
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setRemaining(Math.max(0, Math.ceil((targetTime - Date.now()) / 1000)))

    intervalRef.current = setInterval(() => {
      const diff = Math.max(0, Math.ceil((targetTime - Date.now()) / 1000))
      setRemaining(diff)
      if (diff <= 0 && intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }, 250)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [targetTime])

  return (
    <div className="text-xs text-nd-text-muted">
      Next retry in:{' '}
      <span className="text-nd-warning font-medium tabular-nums">{remaining}s</span>
    </div>
  )
}
