import { useState, useRef, useEffect, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/utils/cn'
import { eventToCombo, formatCombo } from '@/utils/keybindings'

interface KeyRecorderProps {
  value: string
  defaultValue: string
  onChange: (combo: string) => void
  conflict?: { actionLabel: string; scope: string } | null
}

export function KeyRecorder({ value, defaultValue, onChange, conflict }: KeyRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [pendingCombo, setPendingCombo] = useState<string | null>(null)
  const recorderRef = useRef<HTMLDivElement>(null)

  const displayCombo = pendingCombo ?? value
  const isDefault = value === defaultValue

  const startRecording = useCallback(() => {
    setRecording(true)
    setPendingCombo(null)
  }, [])

  const stopRecording = useCallback((accept: boolean) => {
    if (accept && pendingCombo) {
      onChange(pendingCombo)
    }
    setRecording(false)
    setPendingCombo(null)
  }, [pendingCombo, onChange])

  // Focus the recorder div when entering recording mode
  useEffect(() => {
    if (recording && recorderRef.current) {
      recorderRef.current.focus()
    }
  }, [recording])

  // Handle keydown during recording
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!recording) return

    e.preventDefault()
    e.stopPropagation()

    // Escape cancels recording
    if (e.key === 'Escape') {
      stopRecording(false)
      return
    }

    const combo = eventToCombo(e.nativeEvent)
    if (combo) {
      setPendingCombo(combo)
    }
  }, [recording, stopRecording])

  // Accept pending combo on keyup (after a combo is captured)
  const handleKeyUp = useCallback(() => {
    if (recording && pendingCombo) {
      onChange(pendingCombo)
      setRecording(false)
      setPendingCombo(null)
    }
  }, [recording, pendingCombo, onChange])

  // Cancel recording on blur (click away)
  const handleBlur = useCallback(() => {
    if (recording) {
      stopRecording(false)
    }
  }, [recording, stopRecording])

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1.5">
        <div
          ref={recorderRef}
          tabIndex={0}
          role="button"
          onClick={startRecording}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={handleBlur}
          className={cn(
            'px-2 py-0.5 rounded border text-xs font-mono cursor-pointer select-none outline-none transition-colors min-w-[60px] text-center',
            recording
              ? 'border-nd-accent animate-pulse bg-nd-surface text-nd-accent'
              : 'border-nd-border bg-nd-surface text-nd-text-secondary hover:border-nd-accent/50'
          )}
        >
          {recording
            ? (pendingCombo ? formatCombo(pendingCombo) : 'Press keys...')
            : formatCombo(displayCombo)
          }
        </div>
        {!isDefault && (
          <button
            onClick={() => onChange(defaultValue)}
            className="p-0.5 rounded text-nd-text-muted hover:text-nd-text-secondary transition-colors"
            title="Reset to default"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
      {conflict && !recording && (
        <span className="text-nd-error text-[10px] leading-tight">
          Conflicts with "{conflict.actionLabel}" in {conflict.scope}
        </span>
      )}
    </div>
  )
}
