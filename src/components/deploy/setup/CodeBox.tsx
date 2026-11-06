import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { copyText } from '../copyText'

export function CodeBox({ code, copyable }: { code: string; copyable: boolean }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-nd-border bg-nd-bg-sunken py-2 pl-3 pr-2">
      <code className="max-h-20 min-w-0 flex-1 overflow-auto break-all py-0.5 font-mono text-xs text-nd-text-secondary">{code}</code>
      {copyable && (
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Copy" title="Copy" onClick={() => void copyText(code)}>
          <Copy size={13} />
        </Button>
      )}
    </div>
  )
}
