import { useState, useMemo, useCallback } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/utils/cn'
import { FileRow } from './FileRow'
import type { FileEntry, SortField, SortDirection, PanelType } from '@/types/sftp'

interface FileBrowserProps {
  entries: FileEntry[]
  panelType: PanelType
  selectedPaths: Set<string>
  renamingPath: string | null
  renameValue: string
  showHidden: boolean
  onSelect: (path: string, e: React.MouseEvent) => void
  onOpen: (entry: FileEntry) => void
  onContextMenu: (entry: FileEntry, e: React.MouseEvent) => void
  onEmptyContextMenu?: (e: React.MouseEvent) => void
  onRenameChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  className?: string
}

const COLUMN_HEADERS: { field: SortField; label: string; className: string }[] = [
  { field: 'name', label: 'Name', className: 'flex-1' },
  { field: 'size', label: 'Size', className: 'w-[80px] text-right' },
  { field: 'modifiedAt', label: 'Modified', className: 'w-[140px] text-right' },
  { field: 'permissions', label: 'Permissions', className: 'w-[80px] text-right' }
]

/**
 * Sortable file list with column headers and zebra striping.
 */
export function FileBrowser({
  entries,
  panelType,
  selectedPaths,
  renamingPath,
  renameValue,
  showHidden,
  onSelect,
  onOpen,
  onContextMenu,
  onEmptyContextMenu,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  className
}: FileBrowserProps) {
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const handleHeaderClick = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortField(field)
        setSortDirection('asc')
      }
    },
    [sortField]
  )

  // Filter and sort
  const sortedEntries = useMemo(() => {
    let filtered = entries
    if (!showHidden) {
      filtered = filtered.filter((e) => !e.name.startsWith('.'))
    }

    return [...filtered].sort((a, b) => {
      // Directories first
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }

      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          break
        case 'size':
          cmp = a.size - b.size
          break
        case 'modifiedAt':
          cmp = a.modifiedAt - b.modifiedAt
          break
        case 'permissions':
          cmp = a.permissions - b.permissions
          break
      }

      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [entries, sortField, sortDirection, showHidden])

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_80px_140px_80px] items-center h-7 px-2 bg-nd-bg-tertiary border-b border-nd-border shrink-0 select-none">
        {COLUMN_HEADERS.map((col) => (
          <button
            key={col.field}
            onClick={() => handleHeaderClick(col.field)}
            className={cn(
              'flex items-center gap-1 text-2xs font-medium text-nd-text-muted hover:text-nd-text-secondary transition-colors',
              col.className
            )}
          >
            {col.label}
            {sortField === col.field &&
              (sortDirection === 'asc' ? (
                <ArrowUp size={10} className="text-nd-accent" />
              ) : (
                <ArrowDown size={10} className="text-nd-accent" />
              ))}
          </button>
        ))}
      </div>

      {/* File list */}
      <div
        className="flex-1 overflow-y-auto"
        onContextMenu={(e) => {
          // Only fire for empty-space clicks: if the target is the container itself
          // or the empty-space filler div (not a file row)
          const target = e.target as HTMLElement
          const isFileRow = target.closest('[data-file-row]')
          if (!isFileRow) {
            e.preventDefault()
            onEmptyContextMenu?.(e)
          }
        }}
      >
        {sortedEntries.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-nd-text-muted">
            Empty directory
          </div>
        ) : (
          <>
            {sortedEntries.map((entry) => (
              <FileRow
                key={entry.path}
                entry={entry}
                panelType={panelType}
                isSelected={selectedPaths.has(entry.path)}
                isRenaming={renamingPath === entry.path}
                renameValue={renameValue}
                onRenameChange={onRenameChange}
                onRenameSubmit={onRenameSubmit}
                onRenameCancel={onRenameCancel}
                onClick={(e) => onSelect(entry.path, e)}
                onDoubleClick={() => onOpen(entry)}
                onContextMenu={(e) => onContextMenu(entry, e)}
              />
            ))}
            {/* Empty space filler — allows right-click on empty area below files */}
            <div className="min-h-[60px]" />
          </>
        )}
      </div>

      {/* Selection info */}
      <div className="h-6 px-2 flex items-center border-t border-nd-border bg-nd-bg-secondary shrink-0">
        <span className="text-2xs text-nd-text-muted">
          {sortedEntries.length} items
          {selectedPaths.size > 0 && ` — ${selectedPaths.size} selected`}
        </span>
      </div>
    </div>
  )
}
