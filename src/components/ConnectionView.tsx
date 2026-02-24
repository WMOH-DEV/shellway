import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Terminal, FolderTree, Database, ArrowRightLeft, Activity, Info, ScrollText, Columns, X
} from 'lucide-react'
import { lazy, Suspense } from 'react'

const SQLView = lazy(() => import('@/components/sql/SQLView').then(m => ({ default: m.SQLView })))
import { cn } from '@/utils/cn'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { TerminalTabs } from '@/components/terminal/TerminalTabs'
import { SFTPView } from '@/components/sftp/SFTPView'
import { SplitView } from '@/components/SplitView'
import { PortForwardingView } from '@/components/port-forwarding/PortForwardingView'
import { ActivityLog } from '@/components/log/ActivityLog'
import { ReconnectionOverlay } from '@/components/reconnection/ReconnectionOverlay'
import { ConnectionHealthDashboard } from '@/components/connection/ConnectionHealthDashboard'
import { TransferQueue } from '@/components/sftp/TransferQueue'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUIStore } from '@/stores/uiStore'
import type { ConnectionTab } from '@/types/session'

const MonitorView = lazy(() => import('@/components/monitor/MonitorView').then(m => ({ default: m.MonitorView })))

const SUB_TABS: TabItem[] = [
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={13} /> },
  { id: 'sftp', label: 'SFTP', icon: <FolderTree size={13} /> },
  { id: 'sql', label: 'SQL', icon: <Database size={13} /> },
  { id: 'port-forwarding', label: 'Port Forwarding', icon: <ArrowRightLeft size={13} /> },
  { id: 'monitor', label: 'Monitor', icon: <Activity size={13} /> },
  { id: 'info', label: 'Info', icon: <Info size={13} /> },
  { id: 'log', label: 'Log', icon: <ScrollText size={13} /> }
]

interface ConnectionViewProps {
  tab: ConnectionTab
}

/**
 * Main content view for an active connection tab.
 * Sub-tabs: Terminal | SFTP | Port Forwarding | Info | Log
 *
 * IMPORTANT: Terminal and SFTP are kept mounted (hidden via CSS) to preserve state
 * when switching between tabs. Only Info/Log/PortForwarding are conditionally rendered.
 */
export function ConnectionView({ tab }: ConnectionViewProps) {
  const { updateTab } = useConnectionStore()
  const {
    bottomPanelTab, setBottomPanelTab, transferQueueOpen, toggleTransferQueue,
    splitViewLayout, splitViewRatio, setSplitView
  } = useUIStore()

  // Split view applies when enabled on THIS tab and we're on terminal or sftp sub-tabs
  const showSplitView = !!tab.splitView && (tab.activeSubTab === 'terminal' || tab.activeSubTab === 'sftp')

  // Track which panels have been visited — lazy-mount on first visit, then keep alive
  const [mountedPanels, setMountedPanels] = useState<Set<string>>(() => new Set([tab.activeSubTab]))

  useEffect(() => {
    setMountedPanels((prev) => {
      if (prev.has(tab.activeSubTab)) return prev
      return new Set([...prev, tab.activeSubTab])
    })
  }, [tab.activeSubTab])

  // Persist active view for the "Remember Last" view preference
  useEffect(() => {
    if (tab.activeSubTab === 'terminal' || tab.activeSubTab === 'sftp') {
      try {
        // Save 'both' when split view is active, otherwise save the active sub-tab
        const viewToSave = tab.splitView ? 'both' : tab.activeSubTab
        localStorage.setItem(`shellway:lastView:${tab.sessionId}`, viewToSave)
      } catch {
        // localStorage may be unavailable — silently ignore
      }
    }
  }, [tab.activeSubTab, tab.sessionId, tab.splitView])

  const isReconnecting = tab.status === 'reconnecting'

  const handleRetryNow = useCallback(() => {
    window.novadeck.ssh.reconnectRetryNow?.(tab.id)
  }, [tab.id])

  const handlePause = useCallback(() => {
    window.novadeck.ssh.reconnectPause?.(tab.id)
  }, [tab.id])

  const handleResume = useCallback(() => {
    window.novadeck.ssh.reconnectResume?.(tab.id)
  }, [tab.id])

  const handleDisconnect = useCallback(() => {
    useConnectionStore.getState().updateTab(tab.id, { status: 'disconnected' })
    window.novadeck.ssh.disconnect?.(tab.id)
  }, [tab.id])

  return (
    <div className="flex flex-col h-full relative">
      {/* Sub-tab navigation */}
      <div className="px-3 shrink-0 bg-nd-bg-secondary border-b border-nd-border flex items-center">
        <div className="flex-1">
          <Tabs
            tabs={SUB_TABS}
            activeTab={tab.activeSubTab}
            onTabChange={(id) =>
              updateTab(tab.id, {
                activeSubTab: id as ConnectionTab['activeSubTab']
              })
            }
            size="sm"
          />
        </div>
        {/* Split view toggle */}
        {(tab.activeSubTab === 'terminal' || tab.activeSubTab === 'sftp') && (
          <button
            onClick={() => {
              const next = !tab.splitView
              updateTab(tab.id, { splitView: next })
              setSplitView(next)
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors mr-1',
              tab.splitView
                ? 'bg-nd-accent/15 text-nd-accent hover:bg-nd-accent/25'
                : 'text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
            )}
            title={tab.splitView ? 'Exit Split View' : 'Split View (Terminal + SFTP)'}
          >
            {tab.splitView ? <X size={12} /> : <Columns size={12} />}
            <span>{tab.splitView ? 'Exit Split' : 'Split'}</span>
          </button>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden relative">
          {/*
           * Terminal & SFTP: kept mounted via display:none to preserve state.
           * When split view is active, SplitView replaces the individual panels.
           * Other panels: conditionally rendered (lightweight, no state to preserve).
           */}

          {/* Split view — Terminal + SFTP side-by-side */}
          {showSplitView && (
            <div className="absolute inset-0">
              <SplitView
                connectionId={tab.id}
                sessionId={tab.sessionId}
                connectionStatus={tab.status}
                layout={splitViewLayout}
                ratio={splitViewRatio}
                onRatioChange={(r) => setSplitView(true, undefined, r)}
              />
            </div>
          )}

          {/* Terminal — always mounted once visited, hidden when not active or when split view is shown */}
          {!showSplitView && mountedPanels.has('terminal') && (
            <div className={cn(
              'absolute inset-0',
              tab.activeSubTab !== 'terminal' && 'hidden'
            )}>
              <TerminalTabs connectionId={tab.id} connectionStatus={tab.status} />
            </div>
          )}

          {/* SFTP — always mounted once visited, hidden when not active or when split view is shown */}
          {!showSplitView && mountedPanels.has('sftp') && (
            <div className={cn(
              'absolute inset-0 flex flex-col',
              tab.activeSubTab !== 'sftp' && 'hidden'
            )}>
              <SFTPView connectionId={tab.id} sessionId={tab.sessionId} connectionStatus={tab.status} />
            </div>
          )}

          {/* SQL — always mounted once visited, hidden when not active */}
          {mountedPanels.has('sql') && (
            <div className={cn(
              'absolute inset-0 flex flex-col',
              tab.activeSubTab !== 'sql' && 'hidden'
            )}>
              <Suspense fallback={<div className="flex items-center justify-center h-full text-nd-text-muted text-sm">Loading SQL Client...</div>}>
                <SQLView connectionId={tab.id} sessionId={tab.sessionId} />
              </Suspense>
            </div>
          )}

          {/* Port Forwarding — conditionally rendered */}
          {tab.activeSubTab === 'port-forwarding' && (
            <PortForwardingView connectionId={tab.id} />
          )}

          {/* Monitor — conditional render (unmounts to stop SSH polling when not visible) */}
          {tab.activeSubTab === 'monitor' && (
            <div className="absolute inset-0 flex flex-col">
              <Suspense fallback={<div className="flex items-center justify-center h-full text-nd-text-muted text-sm">Loading Monitor...</div>}>
                <MonitorView connectionId={tab.id} sessionId={tab.sessionId} connectionStatus={tab.status} />
              </Suspense>
            </div>
          )}

          {/* Info — Connection Health Dashboard */}
          {tab.activeSubTab === 'info' && (
            <ConnectionHealthDashboard
              connectionId={tab.id}
              sessionName={tab.sessionName}
              status={tab.status}
            />
          )}

          {/* Log */}
          {tab.activeSubTab === 'log' && (
            <ActivityLog sessionId={tab.id} />
          )}

          {/* Reconnection overlay */}
          {isReconnecting && (
            <ReconnectionOverlay
              connectionId={tab.id}
              onRetryNow={handleRetryNow}
              onPause={handlePause}
              onResume={handleResume}
              onDisconnect={handleDisconnect}
            />
          )}
        </div>

        {/* Bottom panel: Transfers | Activity Log */}
        <BottomPanelSwitcher
          activeTab={bottomPanelTab}
          onTabChange={setBottomPanelTab}
          isOpen={transferQueueOpen}
          onToggle={toggleTransferQueue}
          connectionId={tab.id}
        />
      </div>
    </div>
  )
}

// ── Bottom Panel Switcher ──

const MIN_PANEL_HEIGHT = 80
const MAX_PANEL_HEIGHT = 600
const DEFAULT_PANEL_HEIGHT = 200

function BottomPanelSwitcher({
  activeTab,
  onTabChange,
  isOpen,
  onToggle,
  connectionId
}: {
  activeTab: 'transfers' | 'log'
  onTabChange: (tab: 'transfers' | 'log') => void
  isOpen: boolean
  onToggle: () => void
  connectionId: string
}) {
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT)
  const isDragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(DEFAULT_PANEL_HEIGHT)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDragging.current = true
    startY.current = e.clientY
    startHeight.current = panelHeight
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }, [panelHeight])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = startY.current - e.clientY
      const newHeight = Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, startHeight.current + delta))
      setPanelHeight(newHeight)
    }

    const handleMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <div
      className="border-t border-nd-border bg-nd-bg-secondary flex flex-col shrink-0"
      style={{ height: isOpen ? panelHeight : 32 }}
    >
      {/* Resize handle */}
      {isOpen && (
        <div
          onMouseDown={handleMouseDown}
          className="h-1 cursor-ns-resize shrink-0 group flex items-center justify-center hover:bg-nd-accent/30 transition-colors"
          title="Drag to resize"
        >
          <div className="w-10 h-0.5 rounded-full bg-nd-border group-hover:bg-nd-accent/60 transition-colors" />
        </div>
      )}

      {/* Header */}
      <button
        onClick={onToggle}
        className="flex items-center w-full h-8 shrink-0 px-3 hover:bg-nd-surface transition-colors"
      >
        <div className="flex items-center gap-3">
          <span
            onClick={(e) => { e.stopPropagation(); onTabChange('transfers'); if (!isOpen) onToggle() }}
            className={cn(
              'text-xs font-medium cursor-pointer transition-colors',
              activeTab === 'transfers' ? 'text-nd-accent' : 'text-nd-text-muted hover:text-nd-text-secondary'
            )}
          >
            Transfers
          </span>
          <span
            onClick={(e) => { e.stopPropagation(); onTabChange('log'); if (!isOpen) onToggle() }}
            className={cn(
              'text-xs font-medium cursor-pointer transition-colors',
              activeTab === 'log' ? 'text-nd-accent' : 'text-nd-text-muted hover:text-nd-text-secondary'
            )}
          >
            Activity Log
          </span>
        </div>
      </button>

      {/* Panel content */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {activeTab === 'transfers' ? (
            <TransferQueue connectionId={connectionId} />
          ) : (
            <div className="h-full">
              <ActivityLog sessionId={connectionId} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
