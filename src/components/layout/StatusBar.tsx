import { Wifi, WifiOff, HardDrive, Upload } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'

/**
 * Bottom status bar showing connection info, transfer progress, encoding.
 */
export function StatusBar() {
  const { tabs, activeTabId } = useConnectionStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)

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

      {/* Encoding */}
      <span className="text-2xs text-nd-text-muted">UTF-8</span>

      {/* Separator */}
      <div className="w-px h-3 bg-nd-border" />

      {/* App info */}
      <span className="text-2xs text-nd-text-muted">Shellway v0.1.0</span>
    </footer>
  )
}
