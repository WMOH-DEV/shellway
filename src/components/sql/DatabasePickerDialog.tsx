import { useState, useCallback, useEffect, useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { CreateDatabaseDialog } from '@/components/sql/CreateDatabaseDialog'
import { cn } from '@/utils/cn'
import { Database, Search, Loader2, Plus } from 'lucide-react'

interface DatabasePickerDialogProps {
  open: boolean
  onClose: () => void
  sqlSessionId: string
  /** Called when the user selects a database */
  onSelect: (database: string) => void
  /** Database type — needed for the create database dialog */
  dbType?: 'mysql' | 'postgres'
}

export function DatabasePickerDialog({
  open,
  onClose,
  sqlSessionId,
  onSelect,
  dbType,
}: DatabasePickerDialogProps) {
  const [databases, setDatabases] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  // Fetch databases when dialog opens
  useEffect(() => {
    if (!open || !sqlSessionId) return
    setIsLoading(true)
    setError(null)
    setDatabases([])
    setSelected(null)
    setSearch('')

    ;(async () => {
      try {
        const result = await window.novadeck.sql.getDatabases(sqlSessionId)
        if (result.success && result.data) {
          setDatabases(result.data)
          // Auto-select the first one
          if (result.data.length > 0) {
            setSelected(result.data[0])
          }
        } else {
          setError(result.error ?? 'Failed to fetch databases')
        }
      } catch (err: any) {
        setError(err.message ?? 'Failed to fetch databases')
      } finally {
        setIsLoading(false)
      }
    })()
  }, [open, sqlSessionId])

  const filteredDatabases = useMemo(() => {
    if (!search.trim()) return databases
    const q = search.toLowerCase()
    return databases.filter((db) => db.toLowerCase().includes(q))
  }, [databases, search])

  const handleOpen = useCallback(() => {
    if (selected) {
      onSelect(selected)
    }
  }, [selected, onSelect])

  const handleDoubleClick = useCallback(
    (db: string) => {
      onSelect(db)
    },
    [onSelect]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && selected) {
        onSelect(selected)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const idx = filteredDatabases.indexOf(selected ?? '')
        const next = filteredDatabases[idx + 1]
        if (next) setSelected(next)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = filteredDatabases.indexOf(selected ?? '')
        const prev = filteredDatabases[idx - 1]
        if (prev) setSelected(prev)
      }
    },
    [selected, filteredDatabases, onSelect]
  )

  const handleCreated = useCallback(
    (dbName: string) => {
      setShowCreateDialog(false)
      // Add the new database to the list and auto-select it
      setDatabases((prev) => {
        const updated = [...prev, dbName].sort((a, b) => a.localeCompare(b))
        return updated
      })
      setSelected(dbName)
      onSelect(dbName)
    },
    [onSelect]
  )

  return (
    <Modal open={open} onClose={onClose} title="Open database" maxWidth="max-w-sm">
      <div className="flex flex-col gap-3" onKeyDown={handleKeyDown}>
        {/* Search */}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search for database"
          icon={<Search size={13} />}
          autoFocus
          className="text-sm"
        />

        {/* Database list */}
        <div className="min-h-[200px] max-h-[320px] overflow-y-auto rounded-md border border-nd-border bg-nd-bg-primary">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={18} className="animate-spin text-nd-text-muted" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <p className="text-xs text-nd-error">{error}</p>
            </div>
          ) : filteredDatabases.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-nd-text-muted">
                {search ? `No databases matching "${search}"` : 'No databases found'}
              </p>
            </div>
          ) : (
            <div className="py-1">
              {filteredDatabases.map((db) => (
                <button
                  key={db}
                  type="button"
                  onClick={() => setSelected(db)}
                  onDoubleClick={() => handleDoubleClick(db)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors',
                    selected === db
                      ? 'bg-nd-accent/20 text-nd-text-primary'
                      : 'text-nd-text-secondary hover:bg-nd-surface-hover'
                  )}
                >
                  <Database size={14} className="shrink-0 text-nd-accent" />
                  <span className="truncate">{db}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          {dbType && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCreateDialog(true)}
              className="mr-auto"
            >
              <Plus size={14} />
              New Database
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleOpen}
            disabled={!selected || isLoading}
          >
            Open
          </Button>
        </div>
      </div>

      {/* Create database dialog */}
      {dbType && (
        <CreateDatabaseDialog
          open={showCreateDialog}
          onClose={() => setShowCreateDialog(false)}
          sqlSessionId={sqlSessionId}
          dbType={dbType}
          onCreated={handleCreated}
        />
      )}
    </Modal>
  )
}
