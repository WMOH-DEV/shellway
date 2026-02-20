import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { motion } from 'framer-motion'
import { FolderPlus, FilePlus, Clipboard, RefreshCw } from 'lucide-react'
import { cn } from '@/utils/cn'
import { toast } from '@/components/ui/Toast'
import type { PanelType } from '@/types/sftp'

interface EmptySpaceContextMenuProps {
  position: { x: number; y: number }
  panelType: PanelType
  connectionId: string
  currentPath: string
  onClose: () => void
  onRefresh: () => void
}

function joinPath(base: string, name: string): string {
  const sep = base.includes('\\') ? '\\' : '/'
  return base.endsWith(sep) ? base + name : base + sep + name
}

// Shared clipboard reference — reuse from FileContextMenu
// We check if anything is on the system clipboard or internal clipboard
let _internalClipboard: { operation: 'copy' | 'cut'; panelType: PanelType } | null = null

interface MenuItem {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  disabled?: boolean
}

export function EmptySpaceContextMenu({
  position,
  panelType,
  connectionId,
  currentPath,
  onClose,
  onRefresh
}: EmptySpaceContextMenuProps) {
  const isRemote = panelType === 'remote'

  useEffect(() => {
    const handler = () => onClose()
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [onClose])

  const items: MenuItem[] = [
    { id: 'newFolder', label: 'New Folder', icon: <FolderPlus size={13} />, shortcut: 'Ctrl+Shift+N' },
    { id: 'newFile', label: 'New File', icon: <FilePlus size={13} /> },
    { id: 'refresh', label: 'Refresh', icon: <RefreshCw size={13} />, shortcut: 'F5' },
  ]

  const handleAction = useCallback(
    async (id: string) => {
      try {
        switch (id) {
          case 'newFolder': {
            if (isRemote) {
              await window.novadeck.sftp.mkdir(connectionId, joinPath(currentPath, 'New Folder'))
            }
            onRefresh()
            break
          }
          case 'newFile': {
            if (isRemote) {
              await window.novadeck.sftp.writeFile(connectionId, joinPath(currentPath, 'untitled.txt'), '')
            }
            onRefresh()
            break
          }
          case 'refresh': {
            onRefresh()
            break
          }
        }
      } catch (err) {
        toast.error('Action failed', String(err))
      }
    },
    [isRemote, connectionId, currentPath, onRefresh]
  )

  const handleActionAndClose = useCallback(
    (id: string) => {
      onClose()
      setTimeout(() => handleAction(id), 0)
    },
    [onClose, handleAction]
  )

  // ── Position clamping (Windows-style: open downward by default, flip up if needed) ──
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = position

    const spaceBelow = vh - y
    const spaceAbove = y
    if (spaceBelow < rect.height + 8 && spaceAbove >= rect.height + 8) {
      y = y - rect.height
    } else if (spaceBelow < rect.height + 8) {
      y = Math.max(8, vh - rect.height - 8)
    }

    if (x + rect.width > vw - 8) {
      x = Math.max(8, vw - rect.width - 8)
    }

    setAdjustedPos({ x, y })
  }, [position])

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.1 }}
      className="fixed z-[200] min-w-[180px] rounded-lg bg-nd-bg-secondary border border-nd-border shadow-xl py-1"
      style={{
        left: adjustedPos?.x ?? position.x,
        top: adjustedPos?.y ?? position.y,
        visibility: adjustedPos ? 'visible' : 'hidden'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          disabled={item.disabled}
          onClick={() => handleActionAndClose(item.id)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
            'hover:bg-nd-surface disabled:opacity-40 disabled:cursor-not-allowed',
            'text-nd-text-primary'
          )}
        >
          <span className="shrink-0 w-4 text-nd-text-muted">{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          {item.shortcut && (
            <span className="text-2xs text-nd-text-muted">{item.shortcut}</span>
          )}
        </button>
      ))}
    </motion.div>
  )
}
