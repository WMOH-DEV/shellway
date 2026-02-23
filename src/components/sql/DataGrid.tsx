import React, { useMemo, useCallback, useRef, useState, useEffect, useImperativeHandle } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, GetRowIdParams, CellContextMenuEvent, GridReadyEvent } from 'ag-grid-community'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'
import { cn } from '@/utils/cn'
import {
  Copy, ClipboardCopy, FileJson, ArrowUpAZ, ArrowDownAZ,
  XCircle, Filter, EyeOff, RotateCcw, Clipboard,
  ExternalLink, Plus,
} from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import type { QueryResult, SchemaColumn } from '@/types/sql'

ModuleRegistry.registerModules([AllCommunityModule])

// ── Shared theme params (non-color) ──
const sharedThemeParams = {
  headerFontWeight: 600,
  cellEditingBorder: { color: 'rgb(59, 130, 246)', style: 'solid' as const, width: 1 },
  borderRadius: 0,
  wrapperBorderRadius: 0,
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontSize: 12,
  iconSize: 12,
  cellHorizontalPadding: 10,
  spacing: 4,
  columnBorder: true,
}

// ── Dark theme matching Shellway's dark design tokens ──
const shellwayDarkTheme = themeQuartz.withParams({
  ...sharedThemeParams,
  backgroundColor: 'rgb(15, 17, 23)',
  foregroundColor: 'rgb(228, 228, 231)',
  headerBackgroundColor: 'rgb(22, 25, 34)',
  headerTextColor: 'rgb(161, 161, 170)',
  borderColor: 'rgb(46, 51, 72)',
  rowBorder: 'rgb(46, 51, 72)',
  rowHoverColor: 'rgb(37, 40, 54)',
  selectedRowBackgroundColor: 'rgba(59, 130, 246, 0.15)',
  headerColumnResizeHandleColor: 'rgb(61, 67, 99)',
  chromeBackgroundColor: 'rgb(22, 25, 34)',
  oddRowBackgroundColor: 'rgb(18, 20, 28)',
})

// ── Light theme matching Shellway's light design tokens ──
const shellwayLightTheme = themeQuartz.withParams({
  ...sharedThemeParams,
  backgroundColor: 'rgb(255, 255, 255)',
  foregroundColor: 'rgb(15, 23, 42)',
  headerBackgroundColor: 'rgb(248, 250, 252)',
  headerTextColor: 'rgb(71, 85, 105)',
  borderColor: 'rgb(226, 232, 240)',
  rowBorder: 'rgb(226, 232, 240)',
  rowHoverColor: 'rgb(248, 250, 252)',
  selectedRowBackgroundColor: 'rgba(59, 130, 246, 0.1)',
  headerColumnResizeHandleColor: 'rgb(203, 213, 225)',
  chromeBackgroundColor: 'rgb(248, 250, 252)',
  oddRowBackgroundColor: 'rgb(248, 250, 252)',
})

// ── Props ──

/** Map of column name → FK target info for FK navigation */
export interface ForeignKeyMap {
  [columnName: string]: {
    referencedTable: string
    referencedColumn: string
  }
}

interface DataGridProps {
  result: QueryResult | null
  /** column=null means sort was removed */
  onSort: (column: string | null, direction: 'asc' | 'desc') => void
  isLoading: boolean
  onCellEdit?: (rowIndex: number, field: string, oldValue: unknown, newValue: unknown) => void
  /** Column metadata — used to determine which columns are editable */
  columnMeta?: SchemaColumn[]
  /** Called when user selects "Filter with column" from header context menu */
  onFilterColumn?: (column: string) => void
  /** Set of row indices that have pending staged changes (for visual highlighting) */
  editedRows?: Set<number>
  /** Set of "rowIndex-field" keys for cells with pending changes (for cell-level highlighting) */
  editedCells?: Set<string>
  /** Unique key for persisting column widths (e.g. "sql-colw:mysql:host:3306:mydb:users") */
  columnWidthsKey?: string
  /** FK column map for navigation arrows */
  foreignKeys?: ForeignKeyMap
  /** Called when user clicks FK arrow — navigate to referenced table */
  onNavigateFK?: (table: string, filterColumn: string, filterValue: unknown) => void
  /** Called when hidden columns list changes (for external column picker in PaginationBar) */
  onHiddenColumnsChange?: (hiddenColumns: string[]) => void
  /** Called when user requests inserting an empty row */
  onInsertRow?: () => void
  /** Called when user requests duplicating a row */
  onDuplicateRow?: (rowData: Record<string, unknown>) => void
}

/** Imperative handle exposed by DataGrid via ref */
export interface DataGridHandle {
  toggleColumn: (colId: string, show: boolean) => void
  showAllColumns: () => void
}

// ── Context menu state (cell right-click) ──

interface ContextMenuState {
  x: number
  y: number
  items: { label: string; icon: React.ReactNode; action: () => void; separator?: boolean }[]
}

// ── Header context menu state ──

interface HeaderContextMenuState {
  x: number
  y: number
  column: string
}

// ── Custom cell renderers (minimal — only for NULL and boolean) ──

function NullCellRenderer(params: { value: unknown }) {
  if (params.value === null || params.value === undefined) {
    return <span className="italic text-nd-text-muted select-none">(NULL)</span>
  }
  return <>{String(params.value)}</>
}

function BooleanCellRenderer(params: { value: unknown }) {
  if (params.value === null || params.value === undefined) {
    return <span className="italic text-nd-text-muted select-none">(NULL)</span>
  }
  const checked = params.value === true || params.value === 1 || params.value === '1'
  return (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      className="pointer-events-none accent-nd-accent"
    />
  )
}

// ── FK cell renderer — shows value + navigation arrow ──

function FKCellRenderer(props: {
  value: unknown
  colDef: { field?: string }
  context: {
    foreignKeys?: ForeignKeyMap
    onNavigateFK?: (table: string, filterColumn: string, filterValue: unknown) => void
  }
}) {
  const { value, colDef, context } = props
  const field = colDef?.field
  const fk = field ? context.foreignKeys?.[field] : null

  if (value === null || value === undefined) {
    return <span className="italic text-nd-text-muted select-none">(NULL)</span>
  }

  const handleFKClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (fk && context.onNavigateFK && value !== null && value !== undefined) {
      context.onNavigateFK(fk.referencedTable, fk.referencedColumn, value)
    }
  }

  return (
    <span className="flex items-center gap-1 group/fk">
      <span className="truncate">{String(value)}</span>
      {fk && (
        <button
          onClick={handleFKClick}
          className="shrink-0 opacity-0 group-hover/fk:opacity-100 text-nd-accent hover:text-nd-accent/80 transition-opacity"
          title={`Go to ${fk.referencedTable}.${fk.referencedColumn} = ${value}`}
        >
          <ExternalLink size={11} />
        </button>
      )}
    </span>
  )
}

// ── Column type detection ──

const BOOLEAN_TYPES = new Set([
  'boolean',
  'bool',
  'tinyint(1)',
  'bit',
  'bit(1)',
])

function isBooleanType(type: string): boolean {
  return BOOLEAN_TYPES.has(type.toLowerCase())
}

function needsNullRenderer(type: string): boolean {
  return !isBooleanType(type)
}

// ── Clamp context menu position to stay within viewport ──

function clampMenuPosition(x: number, y: number, menuWidth: number, menuHeight: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    left: x + menuWidth > vw ? Math.max(0, vw - menuWidth - 4) : x,
    top: y + menuHeight > vh ? Math.max(0, vh - menuHeight - 4) : y,
  }
}

// ── Context menu button component ──

function CtxMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-nd-text-secondary hover:bg-nd-surface-hover hover:text-nd-text-primary transition-colors"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

function CtxSeparator() {
  return <div className="my-1 h-px bg-nd-border" />
}

// ── Component ──

export const DataGrid = React.memo(React.forwardRef<DataGridHandle, DataGridProps>(function DataGrid({
  result,
  onSort,
  isLoading,
  onCellEdit,
  columnMeta,
  onFilterColumn,
  editedRows,
  editedCells,
  columnWidthsKey,
  foreignKeys,
  onNavigateFK,
  onHiddenColumnsChange,
  onInsertRow,
  onDuplicateRow,
}, ref) {
  const gridRef = useRef<AgGridReact>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [headerContextMenu, setHeaderContextMenu] = useState<HeaderContextMenuState | null>(null)
  const resolvedTheme = useUIStore((s) => s.resolvedTheme)
  const gridTheme = resolvedTheme === 'light' ? shellwayLightTheme : shellwayDarkTheme

  // Close cell context menu on click outside or scroll
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  // Close header context menu on click outside or scroll
  useEffect(() => {
    if (!headerContextMenu) return
    const close = () => setHeaderContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [headerContextMenu])

  // Header right-click listener (event delegation on grid container)
  // Attach header right-click handler — re-run when result changes
  // (the container div is conditionally rendered based on result/isLoading)
  const hasGrid = !!(result || isLoading)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleHeaderRightClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const headerCell = target.closest('.ag-header-cell')
      if (!headerCell) return
      // Ensure it's within the header area (not a cell that happens to match)
      const headerArea = target.closest('.ag-header')
      if (!headerArea) return

      e.preventDefault()
      e.stopPropagation()

      const colId = headerCell.getAttribute('col-id')
      if (!colId) return

      setHeaderContextMenu({ x: e.clientX, y: e.clientY, column: colId })
      // Dismiss cell context menu if open
      setContextMenu(null)
    }

    container.addEventListener('contextmenu', handleHeaderRightClick, true)
    return () => container.removeEventListener('contextmenu', handleHeaderRightClick, true)
  }, [hasGrid])

  // Build a set of non-editable column names (auto-increment PKs, computed columns)
  const nonEditableColumns = useMemo(() => {
    if (!columnMeta) return new Set<string>()
    return new Set(
      columnMeta
        .filter((c) => c.isAutoIncrement || (c.isPrimaryKey && c.isAutoIncrement))
        .map((c) => c.name)
    )
  }, [columnMeta])

  // Column definitions derived from result fields — only table columns, no row numbers
  const columnDefs = useMemo<ColDef[]>(() => {
    if (!result?.fields?.length) return []

    return result.fields.map((field) => {
      const col: ColDef = {
        headerName: field.name,
        field: field.name,
        resizable: true,
        filter: false,
        cellStyle: { fontSize: '13px' },
        tooltipValueGetter: (params) => {
          if (params.value === null || params.value === undefined) return '(NULL)'
          const str = typeof params.value === 'object' ? JSON.stringify(params.value, null, 2) : String(params.value)
          return str.length > 100 ? str : undefined
        },
      }

      if (isBooleanType(field.type)) {
        col.cellRenderer = BooleanCellRenderer
        col.width = 80
      } else if (foreignKeys && foreignKeys[field.name]) {
        // FK column — use FK-aware renderer with navigation arrow
        col.cellRenderer = FKCellRenderer
      } else if (needsNullRenderer(field.type)) {
        col.cellRenderer = NullCellRenderer
      }

      // Only make non-auto-increment columns editable
      if (onCellEdit && !nonEditableColumns.has(field.name)) {
        col.editable = true
      }

      // Highlight individual edited cells
      if (editedCells) {
        col.cellClassRules = {
          'ag-cell-edited': (params) => {
            if (!params.data) return false
            const idx = params.data.__rowIndex as number
            return editedCells.has(`${idx}-${field.name}`)
          },
        }
      }

      return col
    })
  }, [result?.fields, onCellEdit, nonEditableColumns, editedCells, foreignKeys])

  // Row data
  const rowData = useMemo(() => result?.rows ?? [], [result?.rows])

  // Row class rules — highlight rows with staged changes
  const getRowClass = useCallback(
    (params: { data?: Record<string, unknown> }) => {
      if (!editedRows || !params.data) return ''
      const idx = params.data.__rowIndex as number
      return editedRows.has(idx) ? 'ag-row-edited' : ''
    },
    [editedRows]
  )

  // Force ag-grid to re-evaluate row/cell classes when edited sets change
  useEffect(() => {
    if (!gridRef.current?.api) return
    // redrawRows re-evaluates getRowClass and cellClassRules for all visible rows
    gridRef.current.api.redrawRows()
  }, [editedRows, editedCells])

  // Stable row IDs
  const getRowId = useCallback(
    (params: GetRowIdParams) => String(params.data.__rowIndex ?? 0),
    []
  )

  // Default column settings — sortable with no-op comparator (server-side sorting only)
  // Fixed default width (150px) instead of auto-sizing to content — prevents JSON/text
  // blobs from blowing up columns. Users can manually resize wider if needed.
  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      resizable: true,
      filter: false,
      suppressHeaderMenuButton: true,
      comparator: () => 0, // Prevent client-side sorting; server-side only
      unSortIcon: true,
      width: 150,
    }),
    []
  )

  // Handle header click for server-side sorting (asc → desc → none)
  const onSortChanged = useCallback(() => {
    if (!gridRef.current?.api) return
    const sortModel = gridRef.current.api.getColumnState().filter((c) => c.sort)
    if (sortModel.length > 0) {
      const { colId, sort } = sortModel[0]
      if (colId && sort) {
        onSort(colId, sort as 'asc' | 'desc')
      }
    } else {
      // Sort was removed (3rd click cycle)
      onSort(null, 'asc')
    }
  }, [onSort])

  // Cell edit handler
  const onCellValueChanged = useCallback(
    (event: { rowIndex: number | null; colDef: ColDef; oldValue: unknown; newValue: unknown }) => {
      if (!onCellEdit || event.rowIndex === null) return
      onCellEdit(event.rowIndex, event.colDef.field ?? '', event.oldValue, event.newValue)
    },
    [onCellEdit]
  )

  // Right-click context menu on cells
  const onCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    const nativeEvent = event.event as MouseEvent | undefined
    nativeEvent?.preventDefault()

    const cellValue = event.value
    const rowData = event.data

    const items: ContextMenuState['items'] = [
      {
        label: 'Copy Cell',
        icon: <Copy size={13} />,
        action: () => {
          const text = cellValue === null || cellValue === undefined
            ? ''
            : typeof cellValue === 'object'
              ? JSON.stringify(cellValue)
              : String(cellValue)
          navigator.clipboard.writeText(text)
        },
      },
      {
        label: 'Copy Row as JSON',
        icon: <FileJson size={13} />,
        action: () => {
          if (rowData) {
            const { __rowIndex, ...clean } = rowData
            navigator.clipboard.writeText(JSON.stringify(clean, null, 2))
          }
        },
      },
      {
        label: 'Copy Row as INSERT',
        icon: <ClipboardCopy size={13} />,
        action: () => {
          if (rowData) {
            const { __rowIndex, ...clean } = rowData
            const cols = Object.keys(clean).join(', ')
            const vals = Object.values(clean)
              .map((v) =>
                v === null || v === undefined
                  ? 'NULL'
                  : typeof v === 'number'
                    ? String(v)
                    : `'${String(v).replace(/'/g, "''")}'`
              )
              .join(', ')
            navigator.clipboard.writeText(`INSERT INTO table_name (${cols}) VALUES (${vals});`)
          }
        },
      },
    ]

    // Insert / Duplicate row actions
    if (onInsertRow || onDuplicateRow) {
      items.push({ label: '', icon: null, action: () => {}, separator: true })
      if (onInsertRow) {
        items.push({
          label: 'Insert Empty Row',
          icon: <Plus size={13} />,
          action: () => onInsertRow(),
        })
      }
      if (onDuplicateRow && rowData) {
        items.push({
          label: 'Duplicate Row',
          icon: <Copy size={13} />,
          action: () => {
            const { __rowIndex, ...clean } = rowData
            onDuplicateRow(clean)
          },
        })
      }
    }

    setContextMenu({
      x: nativeEvent?.clientX ?? 0,
      y: nativeEvent?.clientY ?? 0,
      items,
    })
  }, [onInsertRow, onDuplicateRow])

  // ── Header context menu actions ──

  const handleHeaderCopyName = useCallback((column: string) => {
    navigator.clipboard.writeText(column)
    setHeaderContextMenu(null)
  }, [])

  const handleHeaderSortAsc = useCallback((column: string) => {
    gridRef.current?.api?.applyColumnState({
      state: [{ colId: column, sort: 'asc' }],
      defaultState: { sort: null },
    })
    setHeaderContextMenu(null)
  }, [])

  const handleHeaderSortDesc = useCallback((column: string) => {
    gridRef.current?.api?.applyColumnState({
      state: [{ colId: column, sort: 'desc' }],
      defaultState: { sort: null },
    })
    setHeaderContextMenu(null)
  }, [])

  const handleHeaderRemoveSort = useCallback(() => {
    gridRef.current?.api?.applyColumnState({
      defaultState: { sort: null },
    })
    setHeaderContextMenu(null)
  }, [])

  const handleHeaderFilterColumn = useCallback((column: string) => {
    onFilterColumn?.(column)
    setHeaderContextMenu(null)
  }, [onFilterColumn])

  const handleHeaderHideColumn = useCallback((column: string) => {
    gridRef.current?.api?.setColumnsVisible([column], false)
    setHeaderContextMenu(null)
  }, [])

  const handleHeaderResetColumns = useCallback(() => {
    const api = gridRef.current?.api
    if (!api) return
    // Unhide all columns first
    const allCols = api.getColumns()?.map((c) => c.getColId()) ?? []
    if (allCols.length > 0) {
      api.setColumnsVisible(allCols, true)
    }
    api.resetColumnState()
    // Clear saved column widths — columns reset to defaultColDef.width (150px)
    if (columnWidthsKeyRef.current) {
      try { localStorage.removeItem(columnWidthsKeyRef.current) } catch {}
    }
    setHeaderContextMenu(null)
  }, [])

  // Auto-size columns on first data render
  // ── Column width persistence ──
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const columnWidthsKeyRef = useRef(columnWidthsKey)
  columnWidthsKeyRef.current = columnWidthsKey

  const onColumnResized = useCallback((event: { finished?: boolean; source?: string }) => {
    // Only persist after user finishes dragging — ignore programmatic resizes
    if (!event.finished || !columnWidthsKeyRef.current) return
    if (event.source !== 'uiColumnResized') return

    // Debounce to avoid writing on every pixel of drag
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    resizeTimerRef.current = setTimeout(() => {
      if (!gridRef.current?.api || !columnWidthsKeyRef.current) return
      const state = gridRef.current.api.getColumnState()
      const widths: Record<string, number> = {}
      for (const col of state) {
        if (col.colId && col.width) {
          widths[col.colId] = col.width
        }
      }
      try {
        localStorage.setItem(columnWidthsKeyRef.current, JSON.stringify(widths))
      } catch {
        // Storage full or unavailable — ignore
      }
    }, 300)
  }, [])

  const onGridReady = useCallback((_event: GridReadyEvent) => {
    // Column sizing is handled in the useEffect below (after data loads)
  }, [])

  // ── Track hidden columns for external column picker ──
  const onHiddenColumnsChangeRef = useRef(onHiddenColumnsChange)
  onHiddenColumnsChangeRef.current = onHiddenColumnsChange

  const syncHiddenColumns = useCallback(() => {
    const api = gridRef.current?.api
    if (!api) return
    const hidden = api.getColumnState()
      .filter((c) => c.hide)
      .map((c) => c.colId!)
      .filter(Boolean)
    onHiddenColumnsChangeRef.current?.(hidden)
  }, [])

  // Listen for column visibility changes
  const onColumnVisible = useCallback(() => {
    syncHiddenColumns()
  }, [syncHiddenColumns])

  // Reset hidden columns when table changes, then sync after state restore
  useEffect(() => {
    onHiddenColumnsChangeRef.current?.([])
    const t = setTimeout(syncHiddenColumns, 100)
    return () => clearTimeout(t)
  }, [result?.fields, syncHiddenColumns])

  // ── Column visibility toggle helpers ──
  const handleShowAllColumns = useCallback(() => {
    const api = gridRef.current?.api
    if (!api) return
    const allCols = api.getColumns()?.map((c) => c.getColId()) ?? []
    api.setColumnsVisible(allCols, true)
    syncHiddenColumns()
  }, [syncHiddenColumns])

  const handleToggleColumn = useCallback((colId: string, visible: boolean) => {
    gridRef.current?.api?.setColumnsVisible([colId], visible)
    syncHiddenColumns()
  }, [syncHiddenColumns])

  // Expose column visibility controls to parent via ref
  useImperativeHandle(ref, () => ({
    toggleColumn: handleToggleColumn,
    showAllColumns: handleShowAllColumns,
  }), [handleToggleColumn, handleShowAllColumns])

  // Restore saved column widths when data first loads.
  // No auto-sizing to content — defaultColDef.width (150px) is the baseline.
  // Users can manually resize and their widths are persisted per-table.
  const prevWidthContextRef = useRef<string>('')
  useEffect(() => {
    if (!gridRef.current?.api || !result?.fields?.length) return

    // Run when columns OR table identity changes (handles tables with same column names)
    const contextKey = `${columnWidthsKey}|${result.fields.map((f) => f.name).join(',')}`
    if (contextKey === prevWidthContextRef.current) return
    prevWidthContextRef.current = contextKey

    // Try to restore saved column widths
    if (columnWidthsKey) {
      try {
        const saved = localStorage.getItem(columnWidthsKey)
        if (saved) {
          const widths: Record<string, number> = JSON.parse(saved)
          const hasMatch = result.fields.some((f) => widths[f.name] !== undefined)
          if (hasMatch) {
            const state = gridRef.current.api.getColumnState().map((col) => ({
              ...col,
              width: widths[col.colId!] ?? col.width,
            }))
            gridRef.current.api.applyColumnState({ state })
          }
        }
      } catch {
        // Corrupted data — use default width from defaultColDef
      }
    }
  }, [result?.fields, columnWidthsKey])

  // Inject __rowIndex for stable identity
  const rowDataWithIndex = useMemo(
    () => rowData.map((row, i) => ({ ...row, __rowIndex: i })),
    [rowData]
  )

  if (!result && !isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-nd-text-muted text-sm">
        Select a table to browse data
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full relative',
        isLoading && 'opacity-60 pointer-events-none'
      )}
    >
      <AgGridReact
        ref={gridRef}
        theme={gridTheme}
        rowData={rowDataWithIndex}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={getRowId}
        getRowClass={getRowClass}
        context={{ foreignKeys, onNavigateFK }}
        animateRows={false}
        suppressRowVirtualisation={false}
        rowSelection="multiple"
        enableCellTextSelection
        suppressRowClickSelection
        headerHeight={32}
        rowHeight={28}
        tooltipShowDelay={300}
        onSortChanged={onSortChanged}
        onCellValueChanged={onCellValueChanged}
        onCellContextMenu={onCellContextMenu}
        onGridReady={onGridReady}
        onColumnResized={onColumnResized}
        onColumnVisible={onColumnVisible}
        noRowsOverlayComponent={() => (
          <span className="text-nd-text-muted text-sm">No rows found</span>
        )}
        loadingOverlayComponent={() => (
          <span className="text-nd-text-muted text-sm">Loading...</span>
        )}
        loading={isLoading && !result}
      />

      {/* Floating cell context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border border-nd-border bg-nd-bg-primary py-1 shadow-lg"
          style={clampMenuPosition(contextMenu.x, contextMenu.y, 200, contextMenu.items.length * 30 + 8)}
        >
          {contextMenu.items.map((item, idx) =>
            item.separator ? (
              <CtxSeparator key={`sep-${idx}`} />
            ) : (
              <CtxMenuItem
                key={item.label}
                icon={item.icon}
                label={item.label}
                onClick={() => {
                  item.action()
                  setContextMenu(null)
                }}
              />
            )
          )}
        </div>
      )}

      {/* Floating header context menu */}
      {headerContextMenu && (
        <div
          className="fixed z-50 min-w-[240px] rounded-md border border-nd-border bg-nd-bg-primary py-1 shadow-lg"
          style={clampMenuPosition(headerContextMenu.x, headerContextMenu.y, 260, 280)}
        >
          <CtxMenuItem
            icon={<Clipboard size={13} />}
            label="Copy name"
            onClick={() => handleHeaderCopyName(headerContextMenu.column)}
          />

          <CtxSeparator />

          <CtxMenuItem
            icon={<Filter size={13} />}
            label="Filter with column"
            onClick={() => handleHeaderFilterColumn(headerContextMenu.column)}
          />
          <CtxMenuItem
            icon={<EyeOff size={13} />}
            label="Hide this column"
            onClick={() => handleHeaderHideColumn(headerContextMenu.column)}
          />
          <CtxMenuItem
            icon={<RotateCcw size={13} />}
            label="Reset column Positions and Widths"
            onClick={handleHeaderResetColumns}
          />

          <CtxSeparator />

          <CtxMenuItem
            icon={<ArrowUpAZ size={13} />}
            label="Sort Ascending"
            onClick={() => handleHeaderSortAsc(headerContextMenu.column)}
          />
          <CtxMenuItem
            icon={<ArrowDownAZ size={13} />}
            label="Sort Descending"
            onClick={() => handleHeaderSortDesc(headerContextMenu.column)}
          />
          <CtxMenuItem
            icon={<XCircle size={13} />}
            label="Remove sort"
            onClick={handleHeaderRemoveSort}
          />
        </div>
      )}
    </div>
  )
}))
