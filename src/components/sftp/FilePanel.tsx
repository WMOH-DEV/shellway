import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  FolderPlus,
  Eye,
  EyeOff,
  LayoutList,
  LayoutGrid,
  Home,
  Star,
  ChevronDown
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { PathBreadcrumb } from './PathBreadcrumb'
import { FileBrowser } from './FileBrowser'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { Spinner } from '@/components/ui/Spinner'
import { toast } from '@/components/ui/Toast'
import { useSFTPPathStore } from '@/stores/sftpPathStore'
import { useBookmarkStore } from '@/stores/bookmarkStore'
import type { FileEntry, PanelType, ViewMode } from '@/types/sftp'
import type { SFTPAutocompleteMode } from '@/types/settings'

export interface FilePanelHandle {
  refresh: () => void
  navigate: (path: string) => void
  startRename: (path: string) => void
  getCurrentPath: () => string
}

interface FilePanelProps {
  type: PanelType
  connectionId: string
  /** Session ID — used for path persistence across reconnects */
  sessionId: string
  className?: string
  onFileContextMenu?: (entry: FileEntry, e: React.MouseEvent, panelType: PanelType) => void
  onEmptyContextMenu?: (e: React.MouseEvent, panelType: PanelType) => void
  onReady?: (handle: FilePanelHandle) => void
}

/**
 * A complete file panel — used for both local and remote.
 * Handles navigation, listing, selection, and file operations.
 */
export function FilePanel({
  type,
  connectionId,
  sessionId,
  className,
  onFileContextMenu,
  onEmptyContextMenu,
  onReady
}: FilePanelProps) {
  const savedPath = useSFTPPathStore((s) => s.getPath(sessionId, type))
  const savePath = useSFTPPathStore((s) => s.setPath)

  const [currentPath, setCurrentPath] = useState(savedPath || '/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [history, setHistory] = useState<string[]>([savedPath || '/'])
  const [historyIndex, setHistoryIndex] = useState(0)
  const initializedRef = useRef(false)

  // Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Drag-and-drop state
  const [isDragOver, setIsDragOver] = useState(false)

  // Autocomplete mode from settings
  const [autocompleteMode, setAutocompleteMode] = useState<SFTPAutocompleteMode>('content')

  // Bookmarks
  const bookmarks = useBookmarkStore((s) => s.getBookmarks(sessionId))
  const addBookmark = useBookmarkStore((s) => s.addBookmark)
  const removeBookmark = useBookmarkStore((s) => s.removeBookmark)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const bookmarkDropdownRef = useRef<HTMLDivElement>(null)

  const isCurrentPathBookmarked = bookmarks.some(
    (b) => b.path === currentPath && b.panelType === type
  )

  // Load autocomplete mode from settings
  useEffect(() => {
    window.novadeck.settings.getAll().then((s: any) => {
      if (s?.sftpAutocompleteMode) {
        setAutocompleteMode(s.sftpAutocompleteMode)
      }
    }).catch(() => {})
  }, [])

  // Close bookmark dropdown on outside click
  useEffect(() => {
    if (!showBookmarks) return
    const handler = (e: MouseEvent) => {
      if (bookmarkDropdownRef.current && !bookmarkDropdownRef.current.contains(e.target as Node)) {
        setShowBookmarks(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showBookmarks])

  /** Load directory contents */
  const loadDirectory = useCallback(
    async (path: string) => {
      setLoading(true)
      try {
        let result: { success: boolean; data?: any[]; error?: string }

        if (type === 'remote') {
          result = await window.novadeck.sftp.readdir(connectionId, path)
        } else {
          result = await window.novadeck.sftp.localReaddir(path)
        }

        if (result.success && result.data) {
          setEntries(result.data as FileEntry[])
          setCurrentPath(path)
          setSelectedPaths(new Set())
          // Persist path for tab-switch / reconnect restoration (keyed by sessionId)
          savePath(sessionId, type, path)
        } else {
          toast.error('Failed to load directory', result.error || 'Unknown error')
        }
      } catch (err) {
        toast.error('Failed to load directory', String(err))
      } finally {
        setLoading(false)
      }
    },
    [connectionId, type]
  )

  /** Navigate to a path, adding to history */
  const navigateTo = useCallback(
    (path: string) => {
      loadDirectory(path)
      setHistory((prev) => [...prev.slice(0, historyIndex + 1), path])
      setHistoryIndex((prev) => prev + 1)
    },
    [loadDirectory, historyIndex]
  )

  /** Initial load — restore saved path if available, otherwise use home directory */
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const init = async () => {
      // If we have a saved path from a previous visit, try to restore it
      if (savedPath) {
        try {
          await loadDirectory(savedPath)
          return // Successfully restored
        } catch {
          // Fall through to default path
        }
      }

      if (type === 'local') {
        const home = await window.novadeck.sftp.localHomedir()
        navigateTo(home)
      } else {
        // Try to resolve home directory
        const result = await window.novadeck.sftp.realpath(connectionId, '.')
        navigateTo(result.success && result.data ? result.data : '/')
      }
    }
    init()
  }, [connectionId, type]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Go back in history */
  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1
      setHistoryIndex(newIdx)
      loadDirectory(history[newIdx])
    }
  }, [historyIndex, history, loadDirectory])

  /** Go forward in history */
  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIdx = historyIndex + 1
      setHistoryIndex(newIdx)
      loadDirectory(history[newIdx])
    }
  }, [historyIndex, history, loadDirectory])

  /** Go to parent directory */
  const goUp = useCallback(() => {
    const isWindows = currentPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const parts = currentPath.split(sep).filter(Boolean)
    if (parts.length <= 1) {
      navigateTo(isWindows ? parts[0] + '\\' : '/')
    } else {
      parts.pop()
      navigateTo(isWindows ? parts.join('\\') : '/' + parts.join('/'))
    }
  }, [currentPath, navigateTo])

  /** Handle file double-click/enter */
  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) {
        navigateTo(entry.path)
      } else {
        // TODO: open file preview / editor
      }
    },
    [navigateTo]
  )

  /** Handle selection */
  const handleSelect = useCallback(
    (path: string, e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        setSelectedPaths((prev) => {
          const next = new Set(prev)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      } else if (e.shiftKey) {
        // Range select
        const sortedEntries = entries
        const lastSelected = Array.from(selectedPaths).pop()
        if (lastSelected) {
          const lastIdx = sortedEntries.findIndex((e) => e.path === lastSelected)
          const curIdx = sortedEntries.findIndex((e) => e.path === path)
          if (lastIdx !== -1 && curIdx !== -1) {
            const [start, end] = [Math.min(lastIdx, curIdx), Math.max(lastIdx, curIdx)]
            const range = sortedEntries.slice(start, end + 1).map((e) => e.path)
            setSelectedPaths(new Set([...selectedPaths, ...range]))
            return
          }
        }
        setSelectedPaths(new Set([path]))
      } else {
        setSelectedPaths(new Set([path]))
      }
    },
    [entries, selectedPaths]
  )

  /** Create new folder */
  const handleNewFolder = useCallback(async () => {
    const name = 'New Folder'
    const isWindows = currentPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const newPath = currentPath.endsWith(sep)
      ? currentPath + name
      : currentPath + sep + name

    try {
      if (type === 'remote') {
        await window.novadeck.sftp.mkdir(connectionId, newPath)
      } else {
        // Local mkdir would need a separate IPC — simplified for now
      }
      loadDirectory(currentPath)
    } catch (err) {
      toast.error('Failed to create folder', String(err))
    }
  }, [currentPath, connectionId, type, loadDirectory])

  /** Handle rename */
  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPath || !renameValue) {
      setRenamingPath(null)
      return
    }

    const entry = entries.find((e) => e.path === renamingPath)
    if (!entry) return

    const isWindows = currentPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const newPath = currentPath.endsWith(sep)
      ? currentPath + renameValue
      : currentPath + sep + renameValue

    try {
      if (type === 'remote') {
        await window.novadeck.sftp.rename(connectionId, renamingPath, newPath)
      }
      setRenamingPath(null)
      loadDirectory(currentPath)
    } catch (err) {
      toast.error('Rename failed', String(err))
    }
  }, [renamingPath, renameValue, entries, currentPath, connectionId, type, loadDirectory])

  // Expose imperative handle to parent for context menu actions
  useEffect(() => {
    onReady?.({
      refresh: () => loadDirectory(currentPath),
      navigate: (path: string) => navigateTo(path),
      startRename: (path: string) => {
        const entry = entries.find((e) => e.path === path)
        if (entry) {
          setRenamingPath(path)
          setRenameValue(entry.name)
        }
      },
      getCurrentPath: () => currentPath
    })
  }, [onReady, loadDirectory, currentPath, navigateTo, entries])

  /** Join two path segments */
  const joinPath = useCallback((base: string, name: string) => {
    const sep = base.includes('\\') ? '\\' : '/'
    return base.endsWith(sep) ? base + name : base + sep + name
  }, [])

  /** Extract file name from a path */
  const fileNameFromPath = useCallback((p: string) => {
    const sep = p.includes('\\') ? '\\' : '/'
    const parts = p.split(sep).filter(Boolean)
    return parts[parts.length - 1] || ''
  }, [])

  /** Handle drag-over */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  /** Handle drag-leave */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only set false if we actually leave the panel (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  /** Handle drop */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      // Check for internal Shellway drag (cross-panel transfer)
      const shellwayData = e.dataTransfer.getData('application/shellway-file')
      if (shellwayData) {
        try {
          const data = JSON.parse(shellwayData) as {
            path: string
            panelType: PanelType
            isDirectory: boolean
            name: string
            size: number
          }

          // Only transfer between opposite panels
          if (data.panelType === type) {
            toast.info('Same panel', 'Drag files to the other panel to transfer')
            return
          }

          const destPath = joinPath(currentPath, data.name)
          const transferId = crypto.randomUUID()

          if (type === 'remote') {
            // Dropped on remote panel → upload from local
            await window.novadeck.sftp.upload(
              connectionId, transferId, data.path, destPath, data.size || 0
            )
            toast.info('Upload started', `${data.name} → ${currentPath}`)
          } else {
            // Dropped on local panel → download from remote
            await window.novadeck.sftp.download(
              connectionId, transferId, data.path, destPath, data.size || 0
            )
            toast.info('Download started', `${data.name} → ${currentPath}`)
          }

          // Refresh after a short delay for the transfer to begin
          setTimeout(() => loadDirectory(currentPath), 500)
        } catch (err) {
          toast.error('Transfer failed', String(err))
        }
        return
      }

      // Check for desktop file drops
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        if (type === 'remote') {
          // Upload desktop files to remote
          for (const file of Array.from(e.dataTransfer.files)) {
            const filePath = (file as any).path as string
            if (!filePath) continue
            const name = file.name
            const destPath = joinPath(currentPath, name)
            const transferId = crypto.randomUUID()
            await window.novadeck.sftp.upload(
              connectionId, transferId, filePath, destPath, file.size || 0
            )
            toast.info('Upload started', `${name} → ${currentPath}`)
          }
          setTimeout(() => loadDirectory(currentPath), 500)
        } else {
          toast.info('Local panel', 'Desktop files can only be dropped on the remote panel')
        }
        return
      }
    },
    [type, connectionId, currentPath, loadDirectory, joinPath]
  )

  /** Toggle bookmark for current path */
  const handleToggleBookmark = useCallback(() => {
    if (isCurrentPathBookmarked) {
      const bm = bookmarks.find((b) => b.path === currentPath && b.panelType === type)
      if (bm) removeBookmark(sessionId, bm.id)
    } else {
      const name = fileNameFromPath(currentPath) || currentPath
      addBookmark(sessionId, currentPath, name, type)
    }
  }, [isCurrentPathBookmarked, bookmarks, currentPath, type, sessionId, addBookmark, removeBookmark, fileNameFromPath])

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-nd-bg-primary relative',
        isDragOver && 'ring-2 ring-inset ring-blue-500 ring-dashed',
        className
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 h-8 bg-nd-bg-secondary border-b border-nd-border shrink-0">
        <Tooltip content="Back">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={goBack}
            disabled={historyIndex <= 0}
          >
            <ArrowLeft size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Forward">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={goForward}
            disabled={historyIndex >= history.length - 1}
          >
            <ArrowRight size={13} />
          </Button>
        </Tooltip>
        <Tooltip content="Parent Directory">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={goUp}>
            <ArrowUp size={13} />
          </Button>
        </Tooltip>

        <Tooltip content="Refresh">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => loadDirectory(currentPath)}
          >
            <RefreshCw size={12} />
          </Button>
        </Tooltip>

        <div className="w-px h-4 bg-nd-border mx-0.5" />

        <Tooltip content="New Folder">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewFolder}>
            <FolderPlus size={13} />
          </Button>
        </Tooltip>

        <Tooltip content={showHidden ? 'Hide hidden files' : 'Show hidden files'}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowHidden(!showHidden)}
          >
            {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
          </Button>
        </Tooltip>

        <div className="w-px h-4 bg-nd-border mx-0.5" />

        <Tooltip content={isCurrentPathBookmarked ? 'Remove bookmark' : 'Bookmark this path'}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleToggleBookmark}
          >
            <Star
              size={12}
              className={isCurrentPathBookmarked ? 'fill-yellow-400 text-yellow-400' : ''}
            />
          </Button>
        </Tooltip>

        <div className="relative" ref={bookmarkDropdownRef}>
          <Tooltip content="Bookmarks">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowBookmarks(!showBookmarks)}
              disabled={bookmarks.length === 0}
            >
              <ChevronDown size={10} />
            </Button>
          </Tooltip>

          {showBookmarks && bookmarks.length > 0 && (
            <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] max-h-[200px] overflow-y-auto rounded-md bg-nd-bg-secondary border border-nd-border shadow-xl py-1">
              {bookmarks.map((bm) => (
                <button
                  key={bm.id}
                  onClick={() => {
                    navigateTo(bm.path)
                    setShowBookmarks(false)
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left',
                    'hover:bg-nd-surface text-nd-text-primary transition-colors'
                  )}
                >
                  <Star size={10} className="shrink-0 fill-yellow-400 text-yellow-400" />
                  <span className="truncate flex-1">{bm.name}</span>
                  <span className="text-2xs text-nd-text-muted uppercase">{bm.panelType}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Panel label */}
        <span className="text-2xs text-nd-text-muted uppercase tracking-wider font-medium mr-1">
          {type}
        </span>
      </div>

      {/* Breadcrumb */}
      <div className="px-2 py-1.5 shrink-0">
        <PathBreadcrumb
          path={currentPath}
          onNavigate={navigateTo}
          connectionId={connectionId}
          panelType={type}
          sessionId={sessionId}
          autocompleteMode={autocompleteMode}
        />
      </div>

      {/* File list */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : (
        <FileBrowser
          entries={entries}
          panelType={type}
          selectedPaths={selectedPaths}
          renamingPath={renamingPath}
          renameValue={renameValue}
          showHidden={showHidden}
          onSelect={handleSelect}
          onOpen={handleOpen}
          onContextMenu={(entry, e) => onFileContextMenu?.(entry, e, type)}
          onEmptyContextMenu={(e) => onEmptyContextMenu?.(e, type)}
          onRenameChange={setRenameValue}
          onRenameSubmit={handleRenameSubmit}
          onRenameCancel={() => setRenamingPath(null)}
          className="flex-1"
        />
      )}
    </div>
  )
}
