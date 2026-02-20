import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/utils/cn'
import { Splitter } from '@/components/ui/Splitter'
import { FilePanel, type FilePanelHandle } from './FilePanel'
import { FileContextMenu } from './FileContextMenu'
import { EmptySpaceContextMenu } from './EmptySpaceContextMenu'
import { PermissionsDialog } from './PermissionsDialog'
import { FilePreview } from './FilePreview'
import { toast } from '@/components/ui/Toast'
import type { FileEntry, PanelType } from '@/types/sftp'

/** Tracked temp file → remote path mapping for auto-upload */
interface WatchedFile {
  watchId: string
  tempPath: string
  remotePath: string
  connectionId: string
}

interface SFTPViewProps {
  connectionId: string
  /** Session ID — used for path persistence across reconnects */
  sessionId: string
}

/**
 * Main SFTP dual-pane layout.
 * Left: local filesystem. Right: remote filesystem.
 */
export function SFTPView({ connectionId, sessionId }: SFTPViewProps) {
  const [sftpReady, setSftpReady] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    entry: FileEntry
    x: number
    y: number
    panelType: PanelType
  } | null>(null)

  // Empty-space context menu state
  const [emptyContextMenu, setEmptyContextMenu] = useState<{
    x: number
    y: number
    panelType: PanelType
  } | null>(null)

  // Permissions dialog state
  const [permEntry, setPermEntry] = useState<FileEntry | null>(null)
  const [permPanelType, setPermPanelType] = useState<PanelType>('remote')

  // File preview state
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null)

  // Panel imperative handles for refresh/rename/navigate from context menu
  const localPanelRef = useRef<FilePanelHandle | null>(null)
  const remotePanelRef = useRef<FilePanelHandle | null>(null)

  // ── Auto-upload file watchers ──
  const watchedFilesRef = useRef<Map<string, WatchedFile>>(new Map())

  const getPanelHandle = useCallback((panelType: PanelType) => {
    return panelType === 'local' ? localPanelRef.current : remotePanelRef.current
  }, [])

  // Initialize SFTP session
  useEffect(() => {
    const init = async () => {
      const result = await window.novadeck.sftp.open(connectionId)
      if (result.success) {
        setSftpReady(true)
      } else {
        toast.error('Failed to open SFTP', result.error || 'Unknown error')
      }
    }
    init()

    return () => {
      window.novadeck.sftp.close(connectionId)
      // Clean up all file watchers on unmount
      for (const [, wf] of watchedFilesRef.current) {
        window.novadeck.fs.unwatchFile(wf.watchId)
      }
      watchedFilesRef.current.clear()
    }
  }, [connectionId])

  // Listen for file change events from the watcher and auto-upload
  useEffect(() => {
    const unsub = window.novadeck.fs.onFileChanged(async (watchId, tempPath) => {
      const wf = watchedFilesRef.current.get(watchId)
      if (!wf || wf.connectionId !== connectionId) return

      try {
        toast.info('Auto-uploading...', `Saving changes to ${wf.remotePath.split('/').pop()}`)
        const content = await window.novadeck.fs.readFile(tempPath)
        const result = await window.novadeck.sftp.writeFile(connectionId, wf.remotePath, content)
        if (result?.success !== false) {
          toast.success('Uploaded', `${wf.remotePath.split('/').pop()} synced to server`)
          // Refresh the remote panel to show updated file size
          // Small delay to ensure the write has fully flushed on the remote
          setTimeout(() => {
            remotePanelRef.current?.refresh()
          }, 300)
        } else {
          toast.error('Upload failed', (result as any)?.error || 'Unknown error')
        }
      } catch (err) {
        toast.error('Auto-upload error', String(err))
      }
    })

    return () => { unsub() }
  }, [connectionId])

  /** Register a temp file for auto-upload watching */
  const watchTempFile = useCallback(
    async (tempPath: string, remoteFilePath: string) => {
      const watchId = `watch-${Date.now()}-${Math.random().toString(36).slice(2)}`
      await window.novadeck.fs.watchFile(watchId, tempPath)
      watchedFilesRef.current.set(watchId, {
        watchId,
        tempPath,
        remotePath: remoteFilePath,
        connectionId
      })
    },
    [connectionId]
  )

  const handleContextMenu = useCallback(
    (entry: FileEntry, e: React.MouseEvent, panelType: PanelType) => {
      e.preventDefault()
      setEmptyContextMenu(null) // close empty space menu if open
      setContextMenu({ entry, x: e.clientX, y: e.clientY, panelType })
    },
    []
  )

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent, panelType: PanelType) => {
      e.preventDefault()
      setContextMenu(null) // close file context menu if open
      setEmptyContextMenu({ x: e.clientX, y: e.clientY, panelType })
    },
    []
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    setEmptyContextMenu(null)
  }, [])

  const handlePermissions = useCallback((entry: FileEntry) => {
    if (contextMenu) {
      setPermPanelType(contextMenu.panelType)
    }
    setPermEntry(entry)
  }, [contextMenu])

  const handlePreview = useCallback((entry: FileEntry) => {
    setPreviewEntry(entry)
  }, [])

  // Context menu action callbacks
  const handleRefresh = useCallback(() => {
    if (contextMenu) {
      getPanelHandle(contextMenu.panelType)?.refresh()
    }
  }, [contextMenu, getPanelHandle])

  const handleRename = useCallback((path: string) => {
    if (contextMenu) {
      getPanelHandle(contextMenu.panelType)?.startRename(path)
    }
  }, [contextMenu, getPanelHandle])

  const handleNavigate = useCallback((path: string) => {
    if (contextMenu) {
      getPanelHandle(contextMenu.panelType)?.navigate(path)
    }
  }, [contextMenu, getPanelHandle])

  if (!sftpReady) {
    return (
      <div className="flex-1 flex items-center justify-center w-full">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin w-6 h-6 rounded-full border-2 border-nd-accent border-t-transparent" />
          <span className="text-sm text-nd-text-muted">Opening SFTP session...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 h-full" onClick={closeContextMenu}>
      {/* Dual pane file manager */}
      <div className="flex-1 overflow-hidden">
        <Splitter
          left={
            <FilePanel
              type="local"
              connectionId={connectionId}
              sessionId={sessionId}
              onFileContextMenu={handleContextMenu}
              onEmptyContextMenu={handleEmptyContextMenu}
              onReady={(handle) => { localPanelRef.current = handle }}
            />
          }
          right={
            <FilePanel
              type="remote"
              connectionId={connectionId}
              sessionId={sessionId}
              onFileContextMenu={handleContextMenu}
              onEmptyContextMenu={handleEmptyContextMenu}
              onReady={(handle) => { remotePanelRef.current = handle }}
            />
          }
          direction="horizontal"
          defaultSplit={50}
          minSize={250}
          className="h-full"
        />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <FileContextMenu
          entry={contextMenu.entry}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          panelType={contextMenu.panelType}
          connectionId={connectionId}
          localPath={localPanelRef.current?.getCurrentPath() || ''}
          remotePath={remotePanelRef.current?.getCurrentPath() || '/'}
          onClose={closeContextMenu}
          onRefresh={handleRefresh}
          onRename={handleRename}
          onNavigate={handleNavigate}
          onWatchTempFile={watchTempFile}
          onPermissions={handlePermissions}
          onPreview={handlePreview}
        />
      )}

      {/* Empty-space context menu */}
      {emptyContextMenu && (
        <EmptySpaceContextMenu
          position={{ x: emptyContextMenu.x, y: emptyContextMenu.y }}
          panelType={emptyContextMenu.panelType}
          connectionId={connectionId}
          currentPath={getPanelHandle(emptyContextMenu.panelType)?.getCurrentPath() || '/'}
          onClose={closeContextMenu}
          onRefresh={() => getPanelHandle(emptyContextMenu.panelType)?.refresh()}
        />
      )}

      {/* Permissions dialog */}
      {permEntry && (
        <PermissionsDialog
          open={!!permEntry}
          onClose={() => setPermEntry(null)}
          entry={permEntry}
          connectionId={connectionId}
          onDone={() => {
            getPanelHandle(permPanelType)?.refresh()
          }}
        />
      )}

      {/* File preview modal */}
      <FilePreview
        open={!!previewEntry}
        onClose={() => setPreviewEntry(null)}
        connectionId={connectionId}
        filePath={previewEntry?.path || ''}
        fileName={previewEntry?.name || ''}
        fileSize={previewEntry?.size || 0}
      />
    </div>
  )
}
