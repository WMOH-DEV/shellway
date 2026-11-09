interface ShowAllToggleProps {
  total: number
  limit: number
  expanded: boolean
  noun: string
  onToggle(): void
}

export function ShowAllToggle({ total, limit, expanded, noun, onToggle }: ShowAllToggleProps) {
  if (total <= limit) return null
  return (
    <button type="button" className="self-start text-xs text-nd-accent hover:underline" onClick={onToggle}>
      {expanded ? 'Show fewer' : `Show all ${total} ${noun}`}
    </button>
  )
}
