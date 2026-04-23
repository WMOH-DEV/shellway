import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Loader2 } from 'lucide-react'

export type TableDeleteMode = 'truncate' | 'drop'

interface TableDeleteDialogProps {
  open: boolean
  onClose: () => void
  mode: TableDeleteMode
  tableName: string
  dbType: 'mysql' | 'postgres'
  /** Called with the chosen options when user confirms. Parent executes the SQL. */
  onConfirm: (options: { restartIdentity: boolean; disableForeignKeyCheck: boolean }) => Promise<void>
}

export function TableDeleteDialog({
  open,
  onClose,
  mode,
  tableName,
  dbType,
  onConfirm,
}: TableDeleteDialogProps) {
  const [restartIdentity, setRestartIdentity] = useState(false)
  const [disableForeignKeyCheck, setDisableForeignKeyCheck] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // MySQL TRUNCATE always resets AUTO_INCREMENT, so the option is implicit.
  // DROP removes the table entirely, so the sequence goes with it.
  const restartIdentityAvailable = mode === 'truncate' && dbType === 'postgres'

  useEffect(() => {
    if (!open) return
    setRestartIdentity(false)
    setDisableForeignKeyCheck(false)
    setError(null)
    setIsRunning(false)
  }, [open])

  const handleConfirm = useCallback(async () => {
    setIsRunning(true)
    setError(null)
    try {
      await onConfirm({ restartIdentity, disableForeignKeyCheck })
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || `Failed to ${mode} table`)
    } finally {
      setIsRunning(false)
    }
  }, [onConfirm, restartIdentity, disableForeignKeyCheck, onClose, mode])

  const title =
    mode === 'truncate'
      ? `Truncate table '${tableName}'`
      : `Drop table '${tableName}'`

  const fkHelp =
    dbType === 'postgres'
      ? 'Truncates / drops dependent tables via CASCADE. May present risks of damaging data integrity.'
      : 'Disables FOREIGN_KEY_CHECKS for this operation. May present risks of damaging data integrity.'

  return (
    <Modal open={open} onClose={isRunning ? () => {} : onClose} title={title} maxWidth="max-w-md">
      <div className="flex flex-col gap-4">
        {mode === 'truncate' && (
          <label
            className={
              'flex items-start gap-2.5 ' +
              (restartIdentityAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')
            }
          >
            <input
              type="checkbox"
              checked={restartIdentity}
              onChange={(e) => setRestartIdentity(e.target.checked)}
              disabled={!restartIdentityAvailable || isRunning}
              className="mt-0.5 rounded accent-nd-accent"
            />
            <span className="flex flex-col">
              <span className="text-sm text-nd-text-primary">Restart identity</span>
              <span className="text-xs text-nd-text-muted">
                {dbType === 'postgres'
                  ? 'Resets sequences owned by the table'
                  : 'MySQL resets AUTO_INCREMENT automatically on TRUNCATE'}
              </span>
            </span>
          </label>
        )}

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={disableForeignKeyCheck}
            onChange={(e) => setDisableForeignKeyCheck(e.target.checked)}
            disabled={isRunning}
            className="mt-0.5 rounded accent-nd-accent"
          />
          <span className="flex flex-col">
            <span className="text-sm text-nd-text-primary">Disable foreign key check</span>
            <span className="text-xs text-nd-text-muted">{fkHelp}</span>
          </span>
        </label>

        {mode === 'drop' && (
          <p className="text-xs text-nd-text-muted">
            This will permanently remove the table and all its data. This action cannot be undone.
          </p>
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
          <Button variant={mode === 'drop' ? 'danger' : 'primary'} onClick={handleConfirm} disabled={isRunning}>
            {isRunning && <Loader2 size={14} className="animate-spin" />}
            OK
          </Button>
        </div>
      </div>
    </Modal>
  )
}
