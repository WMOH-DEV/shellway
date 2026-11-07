import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/utils/cn'
import { usePopoverPosition } from './SearchSelectPosition'

export interface SearchSelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SearchSelectProps {
  value: string
  onChange: (value: string) => void
  options: SearchSelectOption[]
  placeholder?: string
  label?: string
  'aria-label'?: string
  disabled?: boolean
  className?: string
  error?: string
  mono?: boolean
  searchPlaceholder?: string
}

const SEARCHABLE_THRESHOLD = 6
const LIST_MAX_HEIGHT = 280
const OPTION_HEIGHT = 28
const LIST_PADDING = 8
const SEARCH_HEIGHT = 32

function estimatedHeight(optionCount: number, searchable: boolean): number {
  const list = Math.min(LIST_MAX_HEIGHT, Math.max(optionCount, 1) * OPTION_HEIGHT + LIST_PADDING)
  return list + (searchable ? SEARCH_HEIGHT : 0)
}

function filterOptions(options: SearchSelectOption[], query: string): SearchSelectOption[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return options
  return options.filter((option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle))
}

function findEnabled(options: SearchSelectOption[], from: number, step: number): number {
  for (let index = from; index >= 0 && index < options.length; index += step) {
    if (!options[index].disabled) return index
  }
  return -1
}

function moveHighlight(options: SearchSelectOption[], current: number, step: number): number {
  const next = findEnabled(options, current + step, step)
  return next === -1 ? current : next
}

function initialHighlight(options: SearchSelectOption[], value: string): number {
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
  return selectedIndex === -1 ? findEnabled(options, 0, 1) : selectedIndex
}

function isPrintableKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey
}

interface PopoverProps {
  popoverRef: RefObject<HTMLDivElement>
  style: CSSProperties
  listId: string
  optionId: (index: number) => string
  options: SearchSelectOption[]
  value: string
  query: string
  highlight: number
  searchable: boolean
  mono?: boolean
  searchPlaceholder: string
  onQueryChange: (query: string) => void
  onHighlight: (index: number) => void
  onChoose: (option: SearchSelectOption) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

function SearchSelectPopover({
  popoverRef,
  style,
  listId,
  optionId,
  options,
  value,
  query,
  highlight,
  searchable,
  mono,
  searchPlaceholder,
  onQueryChange,
  onHighlight,
  onChoose,
  onKeyDown
}: PopoverProps) {
  useEffect(() => {
    if (highlight < 0) return
    document.getElementById(optionId(highlight))?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, optionId])

  return createPortal(
    <div
      ref={popoverRef}
      style={{ position: 'fixed', ...style }}
      className="z-[60] w-max overflow-hidden rounded-lg border border-nd-border bg-nd-bg-secondary shadow-xl"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        autoFocus
        role="combobox"
        aria-expanded
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={highlight >= 0 ? optionId(highlight) : undefined}
        aria-label={searchPlaceholder}
        readOnly={!searchable}
        value={query}
        placeholder={searchPlaceholder}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={
          searchable
            ? 'h-8 w-full border-b border-nd-border bg-transparent px-3 text-xs text-nd-text-primary outline-none placeholder:text-nd-text-muted'
            : 'sr-only'
        }
      />
      <ul id={listId} role="listbox" className="max-h-[280px] overflow-y-auto py-1">
        {options.length === 0 && <li className="px-3 py-2 text-xs text-nd-text-muted">No matches</li>}
        {options.map((option, index) => (
          <li
            key={option.value}
            id={optionId(index)}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled || undefined}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => !option.disabled && onHighlight(index)}
            onClick={() => onChoose(option)}
            className={cn(
              'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-nd-text-primary',
              mono && 'font-mono',
              index === highlight && 'bg-nd-surface',
              option.disabled && 'cursor-not-allowed opacity-40'
            )}
          >
            <span className="flex-1 whitespace-nowrap">{option.label}</span>
            {option.value === value && <Check size={12} className="shrink-0 text-nd-accent" />}
          </li>
        ))}
      </ul>
    </div>,
    document.body
  )
}

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  label,
  'aria-label': ariaLabel,
  disabled,
  className,
  error,
  mono,
  searchPlaceholder = 'Search...'
}: SearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const triggerId = `${baseId}-trigger`
  const listId = `${baseId}-list`
  const optionId = useCallback((index: number) => `${baseId}-option-${index}`, [baseId])
  const searchable = options.length > SEARCHABLE_THRESHOLD
  const position = usePopoverPosition(triggerRef, open, estimatedHeight(options.length, searchable))
  const visibleOptions = useMemo(() => filterOptions(options, query), [options, query])
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const closeOnOutsideMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideMouseDown)
    return () => document.removeEventListener('mousedown', closeOnOutsideMouseDown)
  }, [open])

  const openWith = (initialQuery: string) => {
    setQuery(initialQuery)
    setHighlight(initialHighlight(filterOptions(options, initialQuery), value))
    setOpen(true)
  }

  const closeAndFocusTrigger = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const choose = (option: SearchSelectOption) => {
    if (option.disabled) return
    onChange(option.value)
    closeAndFocusTrigger()
  }

  const changeQuery = (next: string) => {
    setQuery(next)
    setHighlight(findEnabled(filterOptions(options, next), 0, 1))
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openWith('')
    } else if (searchable && isPrintableKey(event)) {
      event.preventDefault()
      openWith(event.key)
    }
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight(moveHighlight(visibleOptions, highlight, event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (highlight >= 0 && visibleOptions[highlight]) choose(visibleOptions[highlight])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAndFocusTrigger()
    } else if (event.key === 'Tab') {
      closeAndFocusTrigger()
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={triggerId} className="text-xs font-medium text-nd-text-secondary">
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? setOpen(false) : openWith(''))}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-nd-bg-sunken px-3 text-left text-sm text-nd-text-primary',
          'border-nd-border-hover cursor-pointer transition-colors duration-150',
          'focus:outline-none focus:border-nd-accent focus:ring-1 focus:ring-nd-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          mono && 'font-mono',
          error && 'border-nd-error focus:border-nd-error focus:ring-nd-error',
          className
        )}
      >
        <span className={cn('truncate', !selected && 'text-nd-text-muted')}>{selected?.label ?? placeholder ?? ''}</span>
        <ChevronDown size={14} className="shrink-0 text-nd-text-muted" />
      </button>
      {error && <p className="text-2xs text-nd-error-fg">{error}</p>}
      {open && position && (
        <SearchSelectPopover
          popoverRef={popoverRef}
          style={position}
          listId={listId}
          optionId={optionId}
          options={visibleOptions}
          value={value}
          query={query}
          highlight={highlight}
          searchable={searchable}
          mono={mono}
          searchPlaceholder={searchPlaceholder}
          onQueryChange={changeQuery}
          onHighlight={setHighlight}
          onChoose={choose}
          onKeyDown={handleSearchKeyDown}
        />
      )}
    </div>
  )
}
