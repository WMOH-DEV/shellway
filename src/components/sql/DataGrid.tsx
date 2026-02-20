import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, GetRowIdParams, CellContextMenuEvent, GridReadyEvent } from 'ag-grid-community'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'
import { cn } from '@/utils/cn'
import { Copy, ClipboardCopy, FileJson } from 'lucide-react'
import type { QueryResult, SchemaColumn } from '@/types/sql'

ModuleRegistry.registerModules([AllCommunityModule])

// ── Custom dark theme matching Shellway's design tokens ──
const shellwayDarkTheme = themeQuartz.withParams({
  backgroundColor: 'rgb(15, 17, 23)',
  foregroundColor: 'rgb(228, 228, 231)',
  headerBackgroundColor: 'rgb(22, 25, 34)',
  headerFontWeight: 600,
  headerTextColor: 'rgb(161, 161, 170)',
  borderColor: 'rgb(46, 51, 72)',
  rowBorder: 'rgb(37, 40, 54)',
  rowHoverColor: 'rgb(37, 40, 54)',
  selectedRowBackgroundColor: 'rgba(59, 130, 246, 0.15)',
  cellEditingBorder: { color: 'rgb(59, 130, 246)', style: 'solid', width: 1 },
  borderRadius: 0,
  wrapperBorderRadius: 0,
  headerColumnResizeHandleColor: 'rgb(61, 67, 99)',
  chromeBackgroundColor: 'rgb(22, 25, 34)',
  oddRowBackgroundColor: 'rgb(15, 17, 23)',
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontSize: 12,
  cellHorizontalPadding: 10,
  spacing: 4,
})

// ── Props ──

interface DataGridProps {
  result: QueryResult | null
  onSort: (column: string, direction: 'asc' | 'desc') => void
  isLoading: boolean
  onCellEdit?: (rowIndex: number, field: string, oldValue: unknown, newValue: unknown) => void
  /** Column metadata — used to determine which columns are editable */
  columnMeta?: SchemaColumn[]
}

// ── Context menu state ──

interface ContextMenuState {
  x: number
  y: number
  items: { label: string; icon: React.ReactNode; action: () => void }[]
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
  // Everything that isn't boolean gets the null renderer only if the column can have nulls.
  // We apply it broadly — it's lightweight and only triggers on null values.
  return !isBooleanType(type)
}

// ── Component ──

export const DataGrid = React.memo(function DataGrid({
  result,
  onSort,
  isLoading,
  onCellEdit,
  columnMeta,
}: DataGridProps) {
  const gridRef = useRef<AgGridReact>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // Close context menu on click outside or scroll
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
        sortable: false, // server-side sorting
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
      } else if (needsNullRenderer(field.type)) {
        col.cellRenderer = NullCellRenderer
      }

      // Only make non-auto-increment columns editable
      if (onCellEdit && !nonEditableColumns.has(field.name)) {
        col.editable = true
      }

      return col
    })
  }, [result?.fields, onCellEdit, nonEditableColumns])

  // Row data
  const rowData = useMemo(() => result?.rows ?? [], [result?.rows])

  // Stable row IDs
  const getRowId = useCallback(
    (params: GetRowIdParams) => String(params.data.__rowIndex ?? 0),
    []
  )

  // Default column settings
  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: false,
      resizable: true,
      filter: false,
      suppressHeaderMenuButton: true,
    }),
    []
  )

  // Handle header click for server-side sorting
  const onSortChanged = useCallback(() => {
    if (!gridRef.current?.api) return
    const sortModel = gridRef.current.api.getColumnState().filter((c) => c.sort)
    if (sortModel.length > 0) {
      const { colId, sort } = sortModel[0]
      if (colId && sort) {
        onSort(colId, sort as 'asc' | 'desc')
      }
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

  // Right-click context menu
  const onCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    const nativeEvent = event.event as MouseEvent | undefined
    nativeEvent?.preventDefault()

    const cellValue = event.value
    const rowData = event.data

    const items = [
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
            // Omit the internal __rowIndex field
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

    setContextMenu({
      x: nativeEvent?.clientX ?? 0,
      y: nativeEvent?.clientY ?? 0,
      items,
    })
  }, [])

  // Auto-size columns on first data render
  const onGridReady = useCallback((event: GridReadyEvent) => {
    if (result?.fields?.length) {
      event.api.autoSizeAllColumns()
    }
  }, [result?.fields?.length])

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
      className={cn(
        'h-full w-full relative',
        isLoading && 'opacity-60 pointer-events-none'
      )}
    >
      <AgGridReact
        ref={gridRef}
        theme={shellwayDarkTheme}
        rowData={rowDataWithIndex}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={getRowId}
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
        noRowsOverlayComponent={() => (
          <span className="text-nd-text-muted text-sm">No rows found</span>
        )}
        loadingOverlayComponent={() => (
          <span className="text-nd-text-muted text-sm">Loading...</span>
        )}
        loading={isLoading && !result}
      />

      {/* Floating context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border border-nd-border bg-nd-bg-primary py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.items.map((item) => (
            <button
              key={item.label}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-nd-text-secondary hover:bg-nd-surface-hover hover:text-nd-text-primary transition-colors"
              onClick={() => {
                item.action()
                setContextMenu(null)
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
