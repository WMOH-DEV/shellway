import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatLimit, parseLimit } from '@/utils/deploy/pipelineSteps'

interface LimitFieldProps {
  seconds: number | null
  onChange: (seconds: number | null) => void
}

export function LimitField({ seconds, onChange }: LimitFieldProps) {
  const [text, setText] = useState(() => formatLimit(seconds))
  const invalid = parseLimit(text) === undefined

  useEffect(() => setText(formatLimit(seconds)), [seconds])

  const commit = () => {
    const parsed = parseLimit(text)
    if (parsed === undefined) {
      setText(formatLimit(seconds))
      return
    }
    setText(formatLimit(parsed))
    if (parsed !== seconds) onChange(parsed)
  }

  return (
    <label
      title="Stops the command after this long. Examples: 10m, 90s, 2h. Empty means no limit."
      className={cn(
        'flex h-7 w-[96px] items-center gap-1.5 rounded-md border bg-nd-bg-primary px-2 text-nd-text-muted',
        'focus-within:border-nd-accent',
        invalid ? 'border-nd-error' : 'border-nd-border hover:border-nd-border-hover'
      )}
    >
      <Clock size={12} className="shrink-0" />
      <input
        aria-label="Time limit"
        className="w-full min-w-0 bg-transparent font-mono text-xs text-nd-text-primary placeholder:font-sans placeholder:text-nd-text-muted focus:outline-none"
        placeholder="No limit"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  )
}
