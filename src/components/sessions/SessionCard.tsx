import {
  MoreVertical, Copy, Trash2, Pencil, ExternalLink,
  Terminal, FolderOpen, Pause, Columns, X, Unplug
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Dropdown } from '@/components/ui/Dropdown'
import { Tooltip } from '@/components/ui/Tooltip'
import type { Session, ConnectionStatus } from '@/types/session'

interface SessionCardProps {
  session: Session
  /** Whether this session's connection is the currently viewed tab */
  isActiveTab?: boolean
  connectionStatus?: ConnectionStatus
  onConnect: () => void
  onConnectTerminal?: () => void
  onConnectSFTP?: () => void
  onConnectBoth?: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  /** Called to disconnect / close the connection tab */
  onDisconnect?: () => void
}

export function SessionCard({
  session,
  isActiveTab,
  connectionStatus,
  onConnect,
  onConnectTerminal,
  onConnectSFTP,
  onConnectBoth,
  onEdit,
  onDuplicate,
  onDelete,
  onDisconnect,
}: SessionCardProps) {
  const isConnected = connectionStatus === 'connected'
  const isConnecting = connectionStatus === 'connecting' || connectionStatus === 'authenticating'
  const isReconnecting = connectionStatus === 'reconnecting'
  const isPaused = connectionStatus === 'paused'
  const isError = connectionStatus === 'error'
  const isDisconnected = connectionStatus === 'disconnected' || !connectionStatus
  const hasConnection = !isDisconnected

  // Build context menu items — add disconnect when connected
  const menuItems = [
    ...(isDisconnected
      ? [{ id: 'connect', label: 'Connect', icon: <ExternalLink size={13} /> }]
      : [{ id: 'disconnect', label: 'Disconnect', icon: <Unplug size={13} />, danger: true }]
    ),
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
      case 'disconnect': onDisconnect?.(); break
      case 'open-terminal': onConnectTerminal?.(); break
      case 'open-sftp': onConnectSFTP?.(); break
      case 'open-both': onConnectBoth?.(); break
      case 'edit': onEdit(); break
      case 'duplicate': onDuplicate(); break
      case 'delete': onDelete(); break
    }
  }

  // Single click behavior: if connected → switch to its tab
  const handleClick = () => {
    if (hasConnection) {
      onConnect() // This switches to the existing tab via AppShell.handleConnect
    }
  }

  // Double click: connect if not connected
  const handleDoubleClick = () => {
    if (isDisconnected) {
      onConnect()
    }
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-md cursor-pointer transition-colors',
        // Active tab = accent left border + filled bg
        isActiveTab
          ? 'bg-nd-accent/10 border-l-2 border-l-nd-accent border-y border-r border-y-nd-accent/20 border-r-nd-accent/20 px-2 py-2'
          // Connected but not active = subtle indicator
          : hasConnection
            ? 'bg-nd-surface/80 border-l-2 border-l-nd-success/50 border border-nd-border/50 px-2 py-2'
            // Not connected — hover only, no persistent selection
            : 'hover:bg-nd-surface/60 border border-transparent px-2.5 py-2'
      )}
    >
      {/* Status / color dot */}
      <div className="relative shrink-0">
        <div
          className={cn('w-2.5 h-2.5 rounded-full', !hasConnection && 'opacity-60')}
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
        {isError && (
          <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-nd-error border border-nd-bg-secondary" />
        )}
      </div>

      {/* Session info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className={cn(
            'text-sm truncate font-medium',
            isActiveTab ? 'text-nd-accent' : 'text-nd-text-primary'
          )}>
            {session.name}
          </p>
          {session.isModified && (
            <span className="text-2xs text-nd-warning shrink-0">(modified)</span>
          )}
        </div>
        <p className="text-2xs text-nd-text-muted truncate">
          {session.username}@{session.host}:{session.port}
        </p>
      </div>

      {/* Action buttons — different for connected vs disconnected */}
      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {hasConnection ? (
          <>
            {/* Close connection button */}
            <Tooltip content="Disconnect" side="top">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDisconnect?.()
                }}
                className="p-1 rounded text-nd-text-muted hover:text-nd-error hover:bg-nd-bg-tertiary transition-colors"
              >
                <X size={13} />
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
          </>
        ) : (
          <>
            {/* Quick launch buttons for disconnected sessions */}
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
          </>
        )}
      </div>
    </div>
  )
}
