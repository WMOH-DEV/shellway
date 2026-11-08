import { AlertTriangle, Check, Loader2, Minus, X } from 'lucide-react'
import { useState } from 'react'
import { CodeBox } from '@/components/deploy/setup/CodeBox'
import { useNowMs } from '@/components/deploy/useNowMs'
import { Button } from '@/components/ui/Button'
import type { ServerFacts, SslReport } from '@/types/ssl'
import { cn } from '@/utils/cn'
import { renewalOutputOf, serverCheckRows, SSL_SUDOERS_FILE, type CheckTone, type ServerCheckRow } from '@/utils/ssl/settingsServer'
import { CardHeading, SettingsCard } from './SettingsCard'

const DOT_STYLE: Record<CheckTone, string> = {
  ok: 'bg-nd-success/12 text-nd-success-fg',
  bad: 'bg-nd-error/12 text-nd-error-fg',
  warn: 'bg-nd-warning/12 text-nd-warning-fg',
  muted: 'bg-nd-surface-raised text-nd-text-muted'
}

const DOT_ICON: Record<CheckTone, JSX.Element> = {
  ok: <Check size={12} strokeWidth={2.6} />,
  bad: <X size={12} strokeWidth={2.6} />,
  warn: <AlertTriangle size={12} strokeWidth={2.4} />,
  muted: <Minus size={12} strokeWidth={2.6} />
}

function CheckDot({ tone }: { tone: CheckTone }) {
  return <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', DOT_STYLE[tone])}>{DOT_ICON[tone]}</span>
}

function SudoersFix({ line }: { line: string }) {
  return (
    <div className="flex flex-col gap-2 pb-1 pl-[30px]">
      <span className="text-xs text-nd-text-secondary">This would ask for a password and fail. Add this line with sudo visudo -f {SSL_SUDOERS_FILE}:</span>
      <CodeBox code={line} copyable />
    </div>
  )
}

function RenewalOutput({ output }: { output: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2 pb-1 pl-[30px]">
      <button type="button" className="self-start text-xs text-nd-accent hover:underline" onClick={() => setOpen(!open)}>
        {open ? 'Hide last renewal output' : 'Show last renewal output'}
      </button>
      {open && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-nd-border bg-nd-bg-sunken p-3 font-mono text-xs text-nd-text-secondary">{output}</pre>
      )}
    </div>
  )
}

function CheckRow({ row, renewalOutput }: { row: ServerCheckRow; renewalOutput: string | null }) {
  return (
    <div className="flex flex-col gap-2 border-b border-nd-border py-2 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <CheckDot tone={row.tone} />
        <span className="flex-1 text-[13px] text-nd-text-primary">{row.name}</span>
        <span className={cn('min-w-0 truncate text-right font-mono text-xs', row.tone === 'bad' ? 'text-nd-error-fg' : 'text-nd-text-muted')} title={row.detail}>{row.detail}</span>
      </div>
      {row.sudoers && <SudoersFix line={row.sudoers} />}
      {row.id === 'renewal' && renewalOutput && <RenewalOutput output={renewalOutput} />}
    </div>
  )
}

function Rows({ facts, now }: { facts: ServerFacts; now: number }) {
  const output = renewalOutputOf(facts)
  return (
    <div className="flex flex-col">
      {serverCheckRows(facts, now).map((row) => <CheckRow key={row.id} row={row} renewalOutput={output} />)}
    </div>
  )
}

export function ServerChecksCard({ report, checking, onRecheck }: { report: SslReport | null; checking: boolean; onRecheck: () => void }) {
  const nowSeconds = Math.floor(useNowMs(false) / 1000)
  return (
    <SettingsCard label="Server checks">
      <CardHeading title="Server checks">
        {report && <span className="text-xs text-nd-text-muted">as {report.facts.user}</span>}
        <Button size="sm" className="ml-auto" disabled={checking} onClick={onRecheck}>
          {checking && <Loader2 size={14} className="animate-spin" />}
          Run again
        </Button>
      </CardHeading>
      {report ? <Rows facts={report.facts} now={nowSeconds} /> : <span className="text-xs text-nd-text-muted">No server check yet. Run it to see what this server can do.</span>}
    </SettingsCard>
  )
}
