import type { ReactNode } from 'react'
import { AlertTriangle, Cloud, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { NameCheck } from '@/types/createSite'
import { cn } from '@/utils/cn'
import type { NameCheckState } from '@/utils/createSite/wizard'

interface NameStatusProps {
  domain: string
  check: NameCheckState | null
  checking: boolean
  onRecheck: () => void
}

function Line({ tone, icon, children }: { tone: 'muted' | 'error'; icon: ReactNode; children: ReactNode }) {
  return (
    <span role="status" className={cn('flex flex-wrap items-center gap-1.5 text-xs', tone === 'error' ? 'text-nd-error-fg' : 'text-nd-text-muted')}>
      {icon}
      {children}
    </span>
  )
}

const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-nd-text-secondary">{children}</span>

function CheckResult({ domain, result }: { domain: string; result: NameCheck }) {
  const warn = <AlertTriangle size={13} aria-hidden />
  if (result.records.length > 0) {
    const records = result.records.map((record) => `${record.type} ${record.content}`).join(', ')
    return <Line tone="error" icon={warn}>{domain} already has DNS records ({records}). Pick a name that is not in use yet.</Line>
  }
  if (result.servedBy !== null) return <Line tone="error" icon={warn}>Already served by <Mono>{result.servedBy}</Mono>. Pick another name.</Line>
  const cloud = <Cloud size={13} className="text-nd-cloudflare" aria-hidden />
  if (result.zone === null) return <Line tone="muted" icon={cloud}>No Cloudflare zone for this name · you add the DNS record by hand · name is free</Line>
  return <Line tone="muted" icon={cloud}>Zone <Mono>{result.zone.name}</Mono> found in Cloudflare · name is free</Line>
}

export function NameStatus({ domain, check, checking, onRecheck }: NameStatusProps) {
  if (checking) return <Line tone="muted" icon={<Loader2 size={13} className="animate-spin" aria-hidden />}>Checking {domain}…</Line>
  if (check === null || check.domain !== domain) return <span className="text-xs text-nd-text-muted">Shellway checks the name when you leave this field.</span>
  if (check.result !== null) return <CheckResult domain={domain} result={check.result} />
  return (
    <Line tone="error" icon={<AlertTriangle size={13} aria-hidden />}>
      {check.error}
      <Button size="sm" variant="ghost" onClick={onRecheck}>Check again</Button>
    </Line>
  )
}
