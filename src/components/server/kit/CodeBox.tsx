import { Copy } from 'lucide-react'
import { toast } from '@/components/ui/Toast'

export function CodeBox({ text, label }: { text: string; label: string }) {
  const copy = () => void navigator.clipboard.writeText(text).then(() => toast.success('Copied'))
  return (
    <div className="flex items-start gap-2 rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-[1.7] text-nd-text-secondary">{text}</pre>
      <button type="button" aria-label={`Copy ${label}`} onClick={copy} className="rounded-md p-1 text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
        <Copy size={14} />
      </button>
    </div>
  )
}
