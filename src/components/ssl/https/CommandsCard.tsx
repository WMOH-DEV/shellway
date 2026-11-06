import { Copy } from 'lucide-react'
import { copyText } from '@/components/deploy/copyText'
import type { CommandRow } from '@/utils/ssl/addHttps/issueView'
import { CardLabel } from '../Card'

export function CommandsCard({ rows }: { rows: CommandRow[] | null }) {
  return (
    <section aria-label="Commands" className="overflow-hidden rounded-[10px] border border-nd-border bg-nd-bg-secondary">
      <div className="flex items-center gap-2.5 border-b border-nd-border px-4 py-3">
        <CardLabel>Will run</CardLabel>
        <span className="text-xs text-nd-text-muted">in order, stops at the first failure</span>
        <div className="flex-1" />
        {rows && (
          <button
            type="button"
            onClick={() => void copyText(rows.map((row) => row.command).join('\n'), 'Commands copied')}
            className="flex items-center gap-1 rounded text-xs text-nd-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
          >
            <Copy size={13} aria-hidden /> Copy all
          </button>
        )}
      </div>
      {rows
        ? (
          <ol className="py-1.5">
            {rows.map((row, index) => (
              <li key={row.tag} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-[9px]">
                <span className="text-right font-mono text-[11px] text-nd-text-muted">{index + 1}</span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-all font-mono text-[12.5px] text-nd-text-primary">{row.command}</span>
                  <span className="text-xs text-nd-text-muted">{row.why}</span>
                </div>
                <span className="rounded bg-nd-bg-tertiary px-1.5 py-0.5 text-[11px] font-medium text-nd-text-muted">{row.tag}</span>
              </li>
            ))}
          </ol>
        )
        : <p className="px-4 py-4 text-[13px] text-nd-text-muted">Enter a valid email address to see the exact commands.</p>}
    </section>
  )
}
