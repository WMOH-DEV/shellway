import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Lock, LockOpen } from 'lucide-react'
import { cn } from '@/utils/cn'
import { SAFE_MODE_OPTIONS } from './SafeModeGate'
import type { SafeMode } from '@/types/sql'

interface SafeModeMenuProps {
  mode: SafeMode
  onChange: (mode: SafeMode) => void
}

export function SafeModeMenu({ mode, onChange }: SafeModeMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSelect = useCallback(
    (value: SafeMode) => {
      onChange(value)
      setOpen(false)
    },
    [onChange]
  )

  const active = SAFE_MODE_OPTIONS.find((option) => option.value === mode)
  const guarded = mode !== 'silent'

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        title={active ? `${active.label} — ${active.description}` : 'Safe mode'}
        className={cn(
          'flex items-center justify-center h-6 w-7 rounded transition-colors',
          open && 'bg-nd-surface',
          guarded
            ? 'text-amber-400 hover:text-amber-300'
            : 'text-nd-text-muted hover:text-nd-text-primary'
        )}
      >
        {guarded ? <Lock size={13} /> : <LockOpen size={13} />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-[26rem] max-w-[calc(100vw-1rem)] rounded-md border border-nd-border bg-nd-bg-secondary shadow-xl py-1">
          {SAFE_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => handleSelect(option.value)}
              className="flex items-start gap-2 w-full px-3 py-2 text-left hover:bg-nd-surface transition-colors"
            >
              <span className="w-4 shrink-0 pt-0.5">
                {option.value === mode && (
                  <Check size={12} className="text-nd-accent" />
                )}
              </span>
              <span
                className={cn(
                  'w-2 h-2 rounded-full shrink-0 mt-1',
                  option.dotClass
                )}
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-nd-text-primary">
                  {option.label}
                </span>
                <span className="block text-[11px] text-nd-text-muted">
                  {option.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
