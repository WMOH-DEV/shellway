import {
  Settings,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Zap,
  Plus,
  Shield,
  KeyRound
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { useUIStore } from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'
import { SessionManager } from '@/components/sessions/SessionManager'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Session } from '@/types/session'

interface SidebarProps {
  onConnect: (session: Session, defaultSubTab?: 'terminal' | 'sftp') => void
}

/**
 * Left sidebar — session manager, groups, quick connect, settings access.
 * Collapsible to icon-only (48px).
 * Includes Host Key Manager access button.
 */
export function Sidebar({ onConnect }: SidebarProps) {
  const { sidebarOpen, toggleSidebar, toggleSettings, toggleHostKeyManager, toggleClientKeyManager } = useUIStore()
  const { sessions } = useSessionStore()

  const width = sidebarOpen ? 260 : 48

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-nd-bg-secondary border-r border-nd-border shrink-0 transition-all duration-200 overflow-hidden'
      )}
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-nd-border">
        {sidebarOpen && (
          <span className="text-xs font-semibold text-nd-text-secondary uppercase tracking-wider">
            Sessions
          </span>
        )}
        <Tooltip content={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} side="right">
          <button
            onClick={toggleSidebar}
            className="p-1 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
          >
            {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </Tooltip>
      </div>

      {sidebarOpen ? (
        <>
          {/* SessionManager handles everything */}
          <SessionManager onConnect={onConnect} />

          {/* Bottom Actions */}
          <div className="shrink-0 border-t border-nd-border px-3 py-2 flex items-center gap-1">
            <Tooltip content="Settings" side="top">
              <button
                onClick={toggleSettings}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Settings size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Client Key Manager" side="top">
              <button
                onClick={toggleClientKeyManager}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <KeyRound size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Host Key Manager" side="top">
              <button
                onClick={toggleHostKeyManager}
                className="p-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <Shield size={15} />
              </button>
            </Tooltip>
            <div className="flex-1" />
            <span className="text-2xs text-nd-text-muted">{sessions.length} sessions</span>
          </div>
        </>
      ) : (
        /* Collapsed icon-only view */
        <div className="flex flex-col items-center gap-1 py-2 flex-1">
          <Tooltip content="Quick Connect" side="right">
            <button className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors">
              <Zap size={16} />
            </button>
          </Tooltip>
          <Tooltip content="New Session" side="right">
            <button className="p-2 rounded text-nd-accent hover:bg-nd-surface transition-colors">
              <Plus size={16} />
            </button>
          </Tooltip>
          <div className="flex-1" />
          <Tooltip content="Client Key Manager" side="right">
            <button
              onClick={toggleClientKeyManager}
              className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
            >
              <KeyRound size={16} />
            </button>
          </Tooltip>
          <Tooltip content="Host Key Manager" side="right">
            <button
              onClick={toggleHostKeyManager}
              className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
            >
              <Shield size={16} />
            </button>
          </Tooltip>
          <Tooltip content="Settings" side="right">
            <button
              onClick={toggleSettings}
              className="p-2 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
            >
              <Settings size={16} />
            </button>
          </Tooltip>
        </div>
      )}
    </aside>
  )
}
