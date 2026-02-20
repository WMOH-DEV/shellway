import {
  Server, MoreVertical, Copy, Trash2, Pencil, ExternalLink,
  Terminal, FolderOpen, Pause, Columns
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Dropdown } from '@/components/ui/Dropdown'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Session, ConnectionStatus } from '@/types/session'

interface SessionCardProps {
  session: Session
  isSelected: boolean
  connectionStatus?: ConnectionStatus
  onSelect: () => void
  onConnect: () => void
  onConnectTerminal?: () => void
  onConnectSFTP?: () => void
  onConnectBoth?: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export function SessionCard({
  session,
  isSelected,
  connectionStatus,
  onSelect,
  onConnect,
  onConnectTerminal,
  onConnectSFTP,
  onConnectBoth,
  onEdit,
  onDuplicate,
  onDelete
}: SessionCardProps) {
  const isConnected = connectionStatus === 'connected'
  const isConnecting = connectionStatus === 'connecting' || connectionStatus === 'authenticating'
  const isReconnecting = connectionStatus === 'reconnecting'
  const isPaused = connectionStatus === 'paused'
  const isError = connectionStatus === 'error'
  const isDisconnected = connectionStatus === 'disconnected' || !connectionStatus

  const menuItems = [
    { id: 'connect', label: isConnected ? 'Open Tab' : 'Connect', icon: <ExternalLink size={13} /> },
    { id: 'sep-launch', label: '', separator: true },
    { id: 'open-terminal', label: 'Open Terminal', icon: <Terminal size={13} /> },
    { id: 'open-sftp', label: 'Open SFTP', icon: <FolderOpen size={13} /> },
    { id: 'open-both', label: 'Open Terminal + SFTP', icon: <Columns size={13} /> },
    { id: 'sep1', label: '', separator: true },
    { id: 'edit', label: 'Edit', icon: <Pencil size={13} /> },
    { id: 'duplicate', label: 'Duplicate', icon: <Copy size={13} /> },
    { id: 'sep2', label: '', separator: true },
    { id: 'delete', label: 'Delete', icon: <Trash2 size={13} />, danger: true }
  ]

  const handleMenuSelect = (id: string) => {
    switch (id) {
      case 'connect': onConnect(); break
      case 'open-terminal': onConnectTerminal?.(); break
      case 'open-sftp': onConnectSFTP?.(); break
      case 'open-both': onConnectBoth?.(); break
      case 'edit': onEdit(); break
      case 'duplicate': onDuplicate(); break
      case 'delete': onDelete(); break
    }
  }

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onConnect}
      className={cn(
        'group relative flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors',
        isSelected
          ? 'bg-nd-surface border border-nd-border'
          : 'hover:bg-nd-surface/60 border border-transparent'
      )}
    >
      {/* Status / color dot */}
      <div className="relative shrink-0">
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: session.color || '#71717a' }}
        />
        {/* Connection status overlay */}
        {isConnected && (
          <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-nd-success border border-nd-bg-secondary" />
        )}
        {isConnecting && (
          <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-nd-warning border border-nd-bg-secondary animate-pulse" />
        )}
        {isReconnecting && (
          <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400 border border-nd-bg-secondary animate-pulse" />
        )}
        {isPaused && (
          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-nd-text-muted border border-nd-bg-secondary flex items-center justify-center">
            <Pause size={6} className="text-nd-bg-secondary" />
          </div>
        )}
        {(isError || isDisconnected) && connectionStatus && connectionStatus !== 'disconnected' && (
          <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-nd-error border border-nd-bg-secondary" />
        )}
      </div>

      {/* Session info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-sm text-nd-text-primary truncate font-medium">{session.name}</p>
          {session.isModified && (
            <span className="text-2xs text-nd-warning shrink-0">(modified)</span>
          )}
        </div>
        <p className="text-2xs text-nd-text-muted truncate">
          {session.username}@{session.host}:{session.port}
        </p>
      </div>

      {/* Quick launch buttons (on hover) */}
      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Tooltip content="Open Terminal" side="top">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onConnectTerminal?.()
            }}
            className="p-1 rounded text-nd-text-muted hover:text-nd-accent hover:bg-nd-bg-tertiary transition-colors"
          >
            <Terminal size={13} />
          </button>
        </Tooltip>
        <Tooltip content="Open SFTP" side="top">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onConnectSFTP?.()
            }}
            className="p-1 rounded text-nd-text-muted hover:text-nd-accent hover:bg-nd-bg-tertiary transition-colors"
          >
            <FolderOpen size={13} />
          </button>
        </Tooltip>

        {/* Context menu */}
        <Dropdown
          trigger={
            <button className="p-1 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-bg-tertiary transition-colors">
              <MoreVertical size={13} />
            </button>
          }
          items={menuItems}
          onSelect={handleMenuSelect}
          align="right"
        />
      </div>
    </div>
  )
}
