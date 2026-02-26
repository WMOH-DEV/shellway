import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Ban, RotateCcw, Clock, Calendar } from 'lucide-react'

/** Sentinel prefix for SQL expressions (NOW(), DEFAULT) that bypass parameterised quoting */
export const SQL_EXPR_PREFIX = '__SQL_EXPR__:'

/** Whitelist of allowed SQL expressions — only these may be injected as raw SQL */
const ALLOWED_SQL_EXPRS: Record<string, string> = {
  'NOW()': 'NOW()',
  'DEFAULT': 'DEFAULT',
}

/**
 * Safely resolve a sentinel value to a raw SQL expression.
 * Returns the SQL expression if whitelisted, or throws on unknown expressions.
 */
export function resolveSQLExpr(sentinelValue: string): string {
  const key = sentinelValue.slice(SQL_EXPR_PREFIX.length)
  const expr = ALLOWED_SQL_EXPRS[key]
  if (!expr) throw new Error(`Unknown SQL expression: ${key}`)
  return expr
}

/** Detect timestamp-like column types (handles precision suffixes like timestamp(6), datetime(3)) */
const TIMESTAMP_PREFIXES = [
  'datetime',
  'timestamp without time zone',
  'timestamp with time zone',
  'timestamptz',
  'timestamp',
  'date',
  'time without time zone',
  'time with time zone',
  'time',
]

export function isTimestampType(type: string): boolean {
  const lower = type.toLowerCase().trim()
  return TIMESTAMP_PREFIXES.some((prefix) =>
    lower === prefix || lower.startsWith(prefix + '(')
  )
}

// ── Timestamp dropdown state (managed by DataGrid) ──

export interface TimestampDropdownState {
  rowIndex: number
  field: string
  /** Anchor position for the floating menu */
  x: number
  y: number
  /** Current cell value */
  currentValue: unknown
}

// ── Floating timestamp dropdown menu ──

interface TimestampDropdownMenuProps {
  state: TimestampDropdownState
  onClose: () => void
  onSetValue: (rowIndex: number, field: string, value: unknown) => void
}

/** Convert a cell value to datetime-local input format */
function toDatetimeLocal(val: unknown): string {
  if (!val) return ''
  try {
    const d = val instanceof Date ? val : new Date(String(val))
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch {
    return ''
  }
}

export function TimestampDropdownMenu({ state, onClose, onSetValue }: TimestampDropdownMenuProps) {
  const [mode, setMode] = useState<'menu' | 'datepicker'>('menu')
  const containerRef = useRef<HTMLDivElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  const commit = useCallback(
    (newVal: unknown) => {
      onSetValue(state.rowIndex, state.field, newVal)
      onClose()
    },
    [state.rowIndex, state.field, onSetValue, onClose]
  )

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Defer to avoid catching the same click that opened the dropdown
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [onClose])

  // Focus date picker when switching to it
  useEffect(() => {
    if (mode === 'datepicker' && dateInputRef.current) {
      dateInputRef.current.focus()
      dateInputRef.current.showPicker?.()
    }
  }, [mode])

  // Clamp position to viewport
  const menuWidth = mode === 'datepicker' ? 220 : 160
  const menuHeight = mode === 'datepicker' ? 80 : 160
  const left = state.x + menuWidth > window.innerWidth ? Math.max(0, window.innerWidth - menuWidth - 4) : state.x
  const top = state.y + menuHeight > window.innerHeight ? Math.max(0, state.y - menuHeight - 30) : state.y

  if (mode === 'datepicker') {
    return (
      <div
        ref={containerRef}
        className="fixed z-50 min-w-[200px] rounded-md border border-nd-border bg-nd-bg-primary p-2 shadow-lg flex flex-col gap-1.5"
        style={{ left, top }}
      >
        <input
          ref={dateInputRef}
          type="datetime-local"
          step="1"
          defaultValue={toDatetimeLocal(state.currentValue)}
          className="w-full rounded border border-nd-border bg-nd-bg-secondary px-2 py-1 text-xs text-nd-text-primary outline-none focus:border-nd-accent"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = (e.target as HTMLInputElement).value
              if (val) {
                commit(val.replace('T', ' '))
              } else {
                onClose()
              }
            }
            if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
        <button
          className="w-full rounded bg-nd-accent px-2 py-1 text-xs text-white hover:bg-nd-accent/90 transition-colors"
          onClick={() => {
            const val = dateInputRef.current?.value
            if (val) {
              commit(val.replace('T', ' '))
            } else {
              onClose()
            }
          }}
        >
          Apply
        </button>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-50 min-w-[160px] rounded-md border border-nd-border bg-nd-bg-primary py-1 shadow-lg"
      style={{ left, top }}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-nd-text-secondary hover:bg-nd-surface-hover hover:text-nd-text-primary transition-colors"
        onClick={() => commit(null)}
      >
        <Ban size={13} />
        NULL
      </button>
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-nd-text-secondary hover:bg-nd-surface-hover hover:text-nd-text-primary transition-colors"
        onClick={() => commit(`${SQL_EXPR_PREFIX}DEFAULT`)}
      >
        <RotateCcw size={13} />
        Default
      </button>
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-nd-text-secondary hover:bg-nd-surface-hover hover:text-nd-text-primary transition-colors"
        onClick={() => commit(`${SQL_EXPR_PREFIX}NOW()`)}
      >
        <Clock size={13} />
        Now()
      </button>
      <div className="my-1 h-px bg-nd-border" />
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-nd-text-secondary hover:bg-nd-surface-hover hover:text-nd-text-primary transition-colors"
        onClick={() => setMode('datepicker')}
      >
        <Calendar size={13} />
        Date picker
      </button>
    </div>
  )
}
