import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Download,
  Upload,
  Pencil,
  Trash2,
  Copy,
  Scissors,
  Clipboard,
  FolderPlus,
  FilePlus,
  Link2,
  Shield,
  Terminal,
  ExternalLink,
  FileText,
  AppWindow,
  Eye
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { toast } from '@/components/ui/Toast'
import type { FileEntry, PanelType } from '@/types/sftp'

interface FileContextMenuProps {
  entry: FileEntry
  position: { x: number; y: number }
  panelType: PanelType
  connectionId: string
  /** Current path of the local panel — used as download destination */
  localPath: string
  /** Current path of the remote panel — used as upload destination */
  remotePath: string
  onClose: () => void
  onRefresh: () => void
  onRename: (path: string) => void
  onNavigate: (path: string) => void
  /** Register a temp file for auto-upload watching (View/Edit flow) */
  onWatchTempFile?: (tempPath: string, remotePath: string) => Promise<void>
  /** Open the permissions dialog for the entry */
  onPermissions?: (entry: FileEntry) => void
  /** Open the file preview modal for the entry */
  onPreview?: (entry: FileEntry) => void
  /** Called after user picks an app via "Open With" — parent shows "set as default" prompt */
  onOpenWithComplete?: (ext: string, appPath: string, appName: string) => void
}

interface MenuItem {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  danger?: boolean
  separator?: boolean
  disabled?: boolean
}

// In-memory clipboard for copy/cut within SFTP panels
let clipboard: { entries: FileEntry[]; operation: 'copy' | 'cut'; panelType: PanelType; connectionId: string } | null = null

function fileName(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(sep).filter(Boolean)
  return parts[parts.length - 1] || ''
}

function parentDir(path: string): string {
  const isWin = path.includes('\\')
  const sep = isWin ? '\\' : '/'
  const parts = path.split(sep).filter(Boolean)
  parts.pop()
  if (parts.length === 0) return isWin ? path.slice(0, 3) : '/'
  return isWin ? parts.join('\\') : '/' + parts.join('/')
}

function joinPath(base: string, name: string): string {
  const sep = base.includes('\\') ? '\\' : '/'
  return base.endsWith(sep) ? base + name : base + sep + name
}

export function FileContextMenu({
  entry,
  position,
  panelType,
  connectionId,
  localPath,
  remotePath,
  onClose,
  onRefresh,
  onRename,
  onNavigate,
  onWatchTempFile,
  onPermissions,
  onPreview,
  onOpenWithComplete
}: FileContextMenuProps) {
  const isRemote = panelType === 'remote'
  const hasClipboard = clipboard !== null

  useEffect(() => {
    const handler = () => onClose()
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [onClose])

  const items: MenuItem[] = [
    ...(entry.isDirectory
      ? [{ id: 'open', label: 'Open', icon: <ExternalLink size={13} /> }]
      : [
          { id: 'view', label: 'View / Edit', icon: <FileText size={13} /> },
          { id: 'preview', label: 'Preview', icon: <Eye size={13} /> },
          { id: 'openWith', label: 'Open With...', icon: <AppWindow size={13} /> },
        ]),
    { id: 'sep1', label: '', icon: null, separator: true },
    ...(isRemote
      ? [{ id: 'download', label: 'Download', icon: <Download size={13} />, shortcut: 'Ctrl+D' }]
      : [{ id: 'upload', label: 'Upload', icon: <Upload size={13} />, shortcut: 'Ctrl+U' }]),
    { id: 'sep2', label: '', icon: null, separator: true },
    { id: 'copy', label: 'Copy', icon: <Copy size={13} />, shortcut: 'Ctrl+C' },
    { id: 'cut', label: 'Cut', icon: <Scissors size={13} />, shortcut: 'Ctrl+X' },
    { id: 'paste', label: 'Paste', icon: <Clipboard size={13} />, shortcut: 'Ctrl+V', disabled: !hasClipboard },
    { id: 'sep3', label: '', icon: null, separator: true },
    { id: 'rename', label: 'Rename', icon: <Pencil size={13} />, shortcut: 'F2' },
    { id: 'duplicate', label: 'Duplicate', icon: <Copy size={13} /> },
    ...(isRemote
      ? [{ id: 'symlink', label: 'Create Symlink', icon: <Link2 size={13} /> }]
      : []),
    { id: 'sep4', label: '', icon: null, separator: true },
    { id: 'newFolder', label: 'New Folder', icon: <FolderPlus size={13} />, shortcut: 'Ctrl+Shift+N' },
    { id: 'newFile', label: 'New File', icon: <FilePlus size={13} /> },
    ...(isRemote
      ? [
          { id: 'sep5', label: '', icon: null, separator: true },
          { id: 'permissions', label: 'Properties / Permissions', icon: <Shield size={13} /> },
        ]
      : []),
    { id: 'sep6', label: '', icon: null, separator: true },
    { id: 'copyPath', label: 'Copy Full Path', icon: <Copy size={13} /> },
    { id: 'sep7', label: '', icon: null, separator: true },
    { id: 'delete', label: 'Delete', icon: <Trash2 size={13} />, danger: true, shortcut: 'Del' }
  ]

  const handleAction = useCallback(
    async (id: string) => {
      try {
        switch (id) {
          // ── Open directory ──
          case 'open':
            if (entry.isDirectory) onNavigate(entry.path)
            break

          // ── Preview: open file preview modal ──
          case 'preview': {
            if (!entry.isDirectory && onPreview) {
              onPreview(entry)
            }
            break
          }

          // ── View / Edit: download to temp, open with stored default app (or system default), watch for changes ──
          case 'view': {
            if (!entry.isDirectory && isRemote) {
              const name = fileName(entry.path)
              toast.info('Opening...', `Downloading ${name} for editing`)
              const tempDir = await window.novadeck.fs.getTempDir()
              const tempPath = joinPath(tempDir, `shellway-${Date.now()}-${name}`)

              const result = await window.novadeck.sftp.readFile(connectionId, entry.path)
              if (result.success && result.data !== undefined) {
                await window.novadeck.fs.writeFile(tempPath, result.data)

                // Check if user has a stored default app for this file extension
                const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : ''
                let opened = false
                if (ext) {
                  const settings = await window.novadeck.settings.getAll() as any
                  const defaultApps: Record<string, string> = settings?.sftpDefaultApps ?? {}
                  const defaultApp = defaultApps[ext]
                  if (defaultApp) {
                    const openResult = await window.novadeck.shell.openFileWithApp(tempPath, defaultApp)
                    if (openResult.success) {
                      opened = true
                    } else {
                      // Stored app failed (may have been moved/deleted) — fall back to system default
                      toast.error('Default app not found', `Falling back to system default for ${ext}`)
                    }
                  }
                }

                if (!opened) {
                  await window.novadeck.shell.openPath(tempPath)
                }

                // Start watching for edits → auto-upload back to server
                if (onWatchTempFile) {
                  await onWatchTempFile(tempPath, entry.path)
                  toast.info('Watching for changes', `Edits to ${name} will auto-upload to server`)
                }
              } else {
                toast.error('Failed to read file', result.error || 'Unknown error')
              }
            } else if (!entry.isDirectory && !isRemote) {
              // Local file — just open directly
              const err = await window.novadeck.shell.openPath(entry.path)
              if (err) toast.error('Failed to open', err)
            }
            break
          }

          // ── Open With: show app picker dialog, then notify parent for "set as default" prompt ──
          case 'openWith': {
            if (!entry.isDirectory) {
              const filePath = isRemote ? await (async () => {
                const name = fileName(entry.path)
                const tempDir = await window.novadeck.fs.getTempDir()
                const tempPath = joinPath(tempDir, `shellway-${Date.now()}-${name}`)
                const result = await window.novadeck.sftp.readFile(connectionId, entry.path)
                if (result.success && result.data !== undefined) {
                  await window.novadeck.fs.writeFile(tempPath, result.data)
                  return tempPath
                } else {
                  toast.error('Failed to read file', result.error || 'Unknown error')
                  return null
                }
              })() : entry.path

              if (filePath) {
                const picked = await window.novadeck.shell.openWithPicker(filePath)
                if (picked && onOpenWithComplete) {
                  const name = fileName(entry.path)
                  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : ''
                  if (ext) {
                    onOpenWithComplete(ext, picked.appPath, picked.appName)
                  }
                }
              }
            }
            break
          }

          // ── Download: remote file → current local panel path ──
          case 'download': {
            if (!localPath) {
              toast.error('Download failed', 'Local panel path not available')
              break
            }
            const destPath = joinPath(localPath, fileName(entry.path))
            const transferId = crypto.randomUUID()
            await window.novadeck.sftp.download(connectionId, transferId, entry.path, destPath, entry.size || 0)
            toast.info('Download started', `${fileName(entry.path)} → ${localPath}`)
            break
          }

          // ── Upload: local file → current remote panel path ──
          case 'upload': {
            if (!remotePath) {
              toast.error('Upload failed', 'Remote panel path not available')
              break
            }
            const destPath = joinPath(remotePath, fileName(entry.path))
            const transferId = crypto.randomUUID()
            await window.novadeck.sftp.upload(connectionId, transferId, entry.path, destPath, entry.size || 0)
            toast.info('Upload started', `${fileName(entry.path)} → ${remotePath}`)
            break
          }

          // ── Copy / Cut / Paste ──
          case 'copy':
            clipboard = { entries: [entry], operation: 'copy', panelType, connectionId }
            toast.info('Copied', fileName(entry.path))
            break

          case 'cut':
            clipboard = { entries: [entry], operation: 'cut', panelType, connectionId }
            toast.info('Cut', fileName(entry.path))
            break

          case 'paste': {
            if (!clipboard || clipboard.entries.length === 0) break
            const destDir = entry.isDirectory ? entry.path : parentDir(entry.path)

            for (const src of clipboard.entries) {
              const dest = joinPath(destDir, fileName(src.path))
              if (isRemote && clipboard.panelType === 'remote') {
                if (clipboard.operation === 'cut') {
                  await window.novadeck.sftp.rename(connectionId, src.path, dest)
                } else {
                  if (!src.isDirectory) {
                    const content = await window.novadeck.sftp.readFile(connectionId, src.path)
                    if (content.success && content.data !== undefined) {
                      await window.novadeck.sftp.writeFile(connectionId, dest, content.data)
                    }
                  } else {
                    toast.error('Cannot copy', 'Directory copy on remote not yet supported')
                  }
                }
              }
            }
            if (clipboard.operation === 'cut') clipboard = null
            onRefresh()
            toast.success('Pasted', 'Files pasted successfully')
            break
          }

          // ── Rename ──
          case 'rename':
            onRename(entry.path)
            break

          // ── Duplicate ──
          case 'duplicate': {
            const name = fileName(entry.path)
            const dir = parentDir(entry.path)
            const ext = name.includes('.') ? '.' + name.split('.').pop() : ''
            const base = ext ? name.slice(0, -(ext.length)) : name
            const dupPath = joinPath(dir, `${base} (copy)${ext}`)

            if (isRemote && !entry.isDirectory) {
              const content = await window.novadeck.sftp.readFile(connectionId, entry.path)
              if (content.success && content.data !== undefined) {
                await window.novadeck.sftp.writeFile(connectionId, dupPath, content.data)
                toast.success('Duplicated', `${base} (copy)${ext}`)
                onRefresh()
              }
            }
            break
          }

          // ── Symlink ──
          case 'symlink': {
            if (isRemote) {
              const linkPath = joinPath(parentDir(entry.path), fileName(entry.path) + '.link')
              await window.novadeck.sftp.symlink(connectionId, entry.path, linkPath)
              toast.success('Symlink created', fileName(entry.path) + '.link')
              onRefresh()
            }
            break
          }

          // ── New Folder ──
          case 'newFolder': {
            const dir = entry.isDirectory ? entry.path : parentDir(entry.path)
            if (isRemote) {
              await window.novadeck.sftp.mkdir(connectionId, joinPath(dir, 'New Folder'))
            }
            onRefresh()
            break
          }

          // ── New File ──
          case 'newFile': {
            const dir = entry.isDirectory ? entry.path : parentDir(entry.path)
            if (isRemote) {
              await window.novadeck.sftp.writeFile(connectionId, joinPath(dir, 'untitled.txt'), '')
            }
            onRefresh()
            break
          }

          // ── Permissions ──
          case 'permissions':
            if (onPermissions) {
              onPermissions(entry)
            } else {
              toast.info('Permissions', `Current: ${entry.permissions?.toString(8) || 'N/A'}`)
            }
            break

          // ── Copy Path ──
          case 'copyPath':
            navigator.clipboard.writeText(entry.path)
            toast.success('Copied', 'Path copied to clipboard')
            break

          // ── Delete ──
          case 'delete': {
            if (isRemote) {
              if (entry.isDirectory) {
                const r = await window.novadeck.sftp.rmdir(connectionId, entry.path, true)
                if (r?.success) toast.success('Deleted', fileName(entry.path))
                else toast.error('Delete failed', r?.error || 'Unknown error')
              } else {
                const r = await window.novadeck.sftp.unlink(connectionId, entry.path)
                if (r?.success) toast.success('Deleted', fileName(entry.path))
                else toast.error('Delete failed', r?.error || 'Unknown error')
              }
              onRefresh()
            }
            break
          }
        }
      } catch (err) {
        toast.error('Action failed', String(err))
      }
    },
    [entry, isRemote, connectionId, panelType, localPath, remotePath, onRefresh, onRename, onNavigate, onWatchTempFile, onPermissions, onPreview, onOpenWithComplete]
  )

  // Wrap handleAction to close the menu first, then execute async work
  const handleActionAndClose = useCallback(
    (id: string) => {
      onClose()
      // Run the actual action after the menu closes (next tick)
      setTimeout(() => handleAction(id), 0)
    },
    [onClose, handleAction]
  )

  // ── Position clamping: flip/shift if menu overflows viewport (Windows-style) ──
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = position

    // Default: open downward from click point.
    // Flip upward only if there's not enough space below but enough above.
    const spaceBelow = vh - y
    const spaceAbove = y
    if (spaceBelow < rect.height + 8 && spaceAbove >= rect.height + 8) {
      y = y - rect.height
    } else if (spaceBelow < rect.height + 8) {
      // Not enough space either way — anchor to bottom of viewport
      y = Math.max(8, vh - rect.height - 8)
    }

    // Shift left if overflows right edge
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
      className="fixed z-[200] min-w-[220px] rounded-lg bg-nd-bg-secondary border border-nd-border shadow-xl py-1"
      style={{
        left: adjustedPos?.x ?? position.x,
        top: adjustedPos?.y ?? position.y,
        // Hide until layout effect has resolved the correct position
        visibility: adjustedPos ? 'visible' : 'hidden'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) =>
        item.separator ? (
          <div key={item.id} className="my-1 border-t border-nd-border" />
        ) : (
          <button
            key={item.id}
            disabled={item.disabled}
            onClick={() => handleActionAndClose(item.id)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
              'hover:bg-nd-surface disabled:opacity-40 disabled:cursor-not-allowed',
              item.danger ? 'text-nd-error' : 'text-nd-text-primary'
            )}
          >
            <span className="shrink-0 w-4 text-nd-text-muted">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-2xs text-nd-text-muted">{item.shortcut}</span>
            )}
          </button>
        )
      )}
    </motion.div>
  )
}
