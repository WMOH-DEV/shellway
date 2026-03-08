import { useEffect } from 'react'
import { Wifi, WifiOff, Upload, Download, ArrowDownToLine, Check, AlertCircle } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUpdateStore } from '@/stores/updateStore'
import { formatSpeed } from '@/utils/fileSize'

/**
 * Bottom status bar showing connection info, transfer progress, encoding,
 * and auto-update progress inline.
 */
export function StatusBar() {
  const { tabs, activeTabId } = useConnectionStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const { status, version, progress, errorMessage, dismiss } = useUpdateStore()

  // Auto-dismiss transient states after a delay
  useEffect(() => {
    if (status === 'up-to-date') {
      const timer = setTimeout(dismiss, 5000)
      return () => clearTimeout(timer)
    }
    if (status === 'error') {
      const timer = setTimeout(dismiss, 8000)
      return () => clearTimeout(timer)
    }
  }, [status, dismiss])

  /** Inline update indicator for the right side of the status bar */
  function renderUpdateSection() {
    switch (status) {
      case 'checking':
        return (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <ArrowDownToLine size={11} className="text-nd-text-muted animate-pulse" />
            <span className="text-2xs text-nd-text-muted">
              Checking for updates
              <AnimatedDots />
            </span>
          </div>
        )

      case 'available':
        return (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <Download size={11} className="text-nd-accent" />
            <span className="text-2xs text-nd-accent">
              Update {version ? `v${version} ` : ''}available
            </span>
          </div>
        )

      case 'downloading':
        return (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <Download size={11} className="text-nd-accent shrink-0" />
            <span className="text-2xs text-nd-text-secondary whitespace-nowrap">
              Downloading{version ? ` v${version}` : ''}
            </span>
            {/* Progress bar */}
            <div className="w-24 h-1.5 rounded-full bg-nd-surface overflow-hidden shrink-0">
              <div
                className="h-full rounded-full bg-nd-accent transition-all duration-300 ease-out"
                style={{ width: `${Math.min(progress?.percent ?? 0, 100)}%` }}
              />
            </div>
            <span className="text-2xs text-nd-text-muted tabular-nums w-8 text-right shrink-0">
              {Math.round(progress?.percent ?? 0)}%
            </span>
            {progress && progress.bytesPerSecond > 0 && (
              <span className="text-2xs text-nd-text-muted tabular-nums shrink-0">
                {formatSpeed(progress.bytesPerSecond)}
              </span>
            )}
          </div>
        )

      case 'ready':
        return (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <Check size={11} className="text-nd-success" />
            <span className="text-2xs text-nd-text-secondary">
              {version ? `v${version} ready` : 'Update ready'}
            </span>
            <button
              onClick={() => window.novadeck.updater.installAndRestart()}
              className="ml-0.5 px-2 py-0.5 rounded text-2xs font-medium bg-nd-accent text-white hover:bg-nd-accent-hover transition-colors"
            >
              Restart to update
            </button>
            <button
              onClick={dismiss}
              className="text-nd-text-muted hover:text-nd-text-secondary transition-colors text-2xs px-0.5"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )

      case 'error':
        return (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <AlertCircle size={11} className="text-nd-error shrink-0" />
            <span className="text-2xs text-nd-error truncate max-w-48" title={errorMessage ?? 'Update failed'}>
              Update failed
            </span>
            <button
              onClick={dismiss}
              className="text-nd-text-muted hover:text-nd-text-secondary transition-colors text-2xs px-0.5"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )

      case 'up-to-date':
        return (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <Check size={11} className="text-nd-success" />
            <span className="text-2xs text-nd-text-muted">Up to date</span>
          </div>
        )

      default:
        return null
    }
  }

  const updateUI = renderUpdateSection()

  return (
    <footer className="flex items-center h-statusbar bg-nd-bg-primary border-t border-nd-border px-3 gap-4 shrink-0 select-none">
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        {activeTab ? (
          <>
            {activeTab.status === 'connected' ? (
              <Wifi size={12} className="text-nd-success" />
            ) : (
              <WifiOff size={12} className="text-nd-text-muted" />
            )}
            <span className="text-2xs text-nd-text-secondary">
              {activeTab.status === 'connected'
                ? `Connected`
                : activeTab.status === 'connecting'
                  ? 'Connecting...'
                  : activeTab.status === 'authenticating'
                    ? 'Authenticating...'
                    : activeTab.status === 'reconnecting'
                      ? 'Reconnecting...'
                      : 'Disconnected'}
            </span>
          </>
        ) : (
          <>
            <WifiOff size={12} className="text-nd-text-muted" />
            <span className="text-2xs text-nd-text-muted">No active connection</span>
          </>
        )}
      </div>

      {/* Separator */}
      <div className="w-px h-3 bg-nd-border" />

      {/* Transfer summary (placeholder) */}
      <div className="flex items-center gap-1.5">
        <Upload size={11} className="text-nd-text-muted" />
        <span className="text-2xs text-nd-text-muted">No transfers</span>
      </div>

      <div className="flex-1" />

      {/* Update status (inline, right-aligned) */}
      {updateUI && (
        <>
          {updateUI}
          <div className="w-px h-3 bg-nd-border" />
        </>
      )}

      {/* Encoding */}
      <span className="text-2xs text-nd-text-muted">UTF-8</span>

      {/* Separator */}
      <div className="w-px h-3 bg-nd-border" />

      {/* App info */}
      <span className="text-2xs text-nd-text-muted">Shellway v{__APP_VERSION__}</span>
    </footer>
  )
}

/** Animated trailing dots (CSS animation, no timers) */
function AnimatedDots() {
  return (
    <span className="inline-flex w-4 overflow-hidden">
      <span className="animate-dots">...</span>
    </span>
  )
}
