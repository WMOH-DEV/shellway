import { ArrowLeft } from 'lucide-react'

export function BackLink({ onBack }: { onBack(): void }) {
  return (
    <button type="button" onClick={onBack} className="flex items-center gap-1.5 self-start text-xs text-nd-text-muted hover:text-nd-text-primary">
      <ArrowLeft size={13} aria-hidden />
      Overview
    </button>
  )
}
