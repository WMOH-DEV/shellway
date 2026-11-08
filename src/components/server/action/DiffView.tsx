import { cn } from '@/utils/cn'

function lineTone(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-nd-text-muted'
  if (line.startsWith('+')) return 'bg-nd-success/[0.08] text-nd-success-fg'
  if (line.startsWith('-')) return 'bg-nd-error/[0.08] text-nd-error-fg'
  if (line.startsWith('@@')) return 'text-nd-info-fg'
  return 'text-nd-text-secondary'
}

export function DiffView({ diff, label }: { diff: string; label: string }) {
  return (
    <pre aria-label={label} className="max-h-80 overflow-auto rounded-lg border border-nd-border bg-nd-bg-sunken py-2 font-mono text-xs leading-[1.7]">
      {diff.split('\n').map((line, index) => (
        <span key={index} className={cn('block whitespace-pre px-3', lineTone(line))}>{line || ' '}</span>
      ))}
    </pre>
  )
}
