import { useState, useCallback, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Loader2, Trash2, Folder, File as FileIcon } from 'lucide-react'

export interface SftpDeleteTarget {
  path: string
  name: string
  isDirectory: boolean
}

interface SftpDeleteConfirmProps {
  open: boolean
  onClose: () => void
  targets: SftpDeleteTarget[]
  /** Runs the actual delete. Parent resolves with the final outcome; errors bubble into the dialog. */
  onConfirm: (targets: SftpDeleteTarget[]) => Promise<void>
}

const MAX_PREVIEW = 10

export function SftpDeleteConfirm({ open, onClose, targets, onConfirm }: SftpDeleteConfirmProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setIsRunning(false)
      setError(null)
    }
  }, [open])

  const handleConfirm = useCallback(async () => {
    setIsRunning(true)
    setError(null)
    try {
      await onConfirm(targets)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || 'Delete failed')
    } finally {
      setIsRunning(false)
    }
  }, [onConfirm, targets, onClose])

  const count = targets.length
  const folderCount = targets.filter((t) => t.isDirectory).length
  const fileCount = count - folderCount

  let title: string
  let summary: string
  if (count === 1) {
    const t = targets[0]
    title = t.isDirectory ? `Delete folder '${t.name}'` : `Delete file '${t.name}'`
    summary = t.isDirectory
      ? 'This will permanently delete the folder and everything inside it.'
      : 'This will permanently delete the file.'
  } else {
    title = `Delete ${count} items`
    const parts: string[] = []
    if (fileCount > 0) parts.push(`${fileCount} ${fileCount === 1 ? 'file' : 'files'}`)
    if (folderCount > 0) parts.push(`${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`)
    summary = `This will permanently delete ${parts.join(' and ')}${
      folderCount > 0 ? ' including all of their contents' : ''
    }.`
  }

  const preview = targets.slice(0, MAX_PREVIEW)
  const extra = targets.length - preview.length

  return (
    <Modal open={open} onClose={isRunning ? () => {} : onClose} title={title} maxWidth="max-w-md">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-nd-error/10 shrink-0">
            <Trash2 size={18} className="text-nd-error" />
          </div>
          <div className="space-y-1">
            <p className="text-sm text-nd-text-primary">{summary}</p>
            <p className="text-xs text-nd-text-muted">This action cannot be undone.</p>
          </div>
        </div>

        {count > 1 && (
          <div className="rounded-md border border-nd-border bg-nd-surface px-2.5 py-2 max-h-40 overflow-y-auto">
            <ul className="text-xs text-nd-text-secondary space-y-0.5">
              {preview.map((t) => (
                <li key={t.path} className="flex items-center gap-1.5 truncate" title={t.path}>
                  {t.isDirectory ? (
                    <Folder size={12} className="shrink-0 text-nd-text-muted" />
                  ) : (
                    <FileIcon size={12} className="shrink-0 text-nd-text-muted" />
                  )}
                  <span className="truncate">{t.name}</span>
                </li>
              ))}
              {extra > 0 && (
                <li className="text-nd-text-muted italic">…and {extra} more</li>
              )}
            </ul>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-nd-error/10 border border-nd-error/20 px-3 py-2">
            <p className="text-xs text-nd-error whitespace-pre-wrap">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={isRunning}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={isRunning}>
            {isRunning && <Loader2 size={14} className="animate-spin" />}
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  )
}
