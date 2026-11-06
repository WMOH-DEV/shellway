import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { CertbotAction, HostnameStatus, ServerFacts } from '@/types/ssl'
import { ACTION_COPY, actionAvailability, FORCE_COPY, shouldEmphasizeTest } from '@/utils/ssl/certbotActions'
import { certbotCommand } from '@/utils/ssl/commands'
import { isMissingServerCertificate } from '@/utils/ssl/addHttps/issueView'
import { Card } from '../Card'
import { OutputPanel } from './OutputPanel'
import type { CertbotRun } from './useCertbotRun'

interface ActionsCardProps {
  host: HostnameStatus
  facts: ServerFacts
  run: CertbotRun
  onForce: () => void
  onAddHttps: (blockId: string) => void
}

interface ActionRowProps {
  title: ReactNode
  command?: string
  note: string
  children?: ReactNode
}

function ActionRow({ title, command, note, children }: ActionRowProps) {
  return (
    <div className="flex items-center gap-3 border-b border-nd-border py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[13px] font-medium text-nd-text-primary">{title}</span>
        {command && <span className="truncate font-mono text-[11.5px] text-nd-text-muted" title={command}>{command}</span>}
        <span className="text-xs text-nd-text-muted">{note}</span>
      </div>
      {children}
    </div>
  )
}

function CertbotRows({ host, facts, run }: Pick<ActionsCardProps, 'host' | 'facts' | 'run'>) {
  const lineage = host.lineage ?? ''
  const emphasizeTest = shouldEmphasizeTest(host, facts)
  const rows: { action: Exclude<CertbotAction, 'force'>; primary: boolean }[] = [
    { action: 'test', primary: emphasizeTest },
    { action: 'renew', primary: false }
  ]
  return (
    <>
      {rows.map(({ action, primary }) => {
        const copy = ACTION_COPY[action]
        const isRunning = run.running === action
        return (
          <ActionRow key={action} title={copy.title} command={certbotCommand(lineage, action)} note={copy.note}>
            <Button variant={primary ? 'primary' : 'secondary'} disabled={run.running !== null} onClick={() => void run.start(lineage, action)}>
              {isRunning && <Loader2 size={14} className="animate-spin" />}
              {copy.button}
            </Button>
          </ActionRow>
        )
      })}
    </>
  )
}

function AddHttpsRow({ host, onAddHttps }: { host: HostnameStatus; onAddHttps: (blockId: string) => void }) {
  return (
    <ActionRow title="Add HTTPS" note="This server does not serve a certificate for this name. Get a free Let's Encrypt certificate with certbot.">
      <Button variant="primary" onClick={() => onAddHttps(host.blockId)}>Add HTTPS</Button>
    </ActionRow>
  )
}

function OriginCaRow() {
  return (
    <ActionRow
      title={<>Switch to Cloudflare Origin CA <Badge>valid up to 15 years</Badge></>}
      note="Removes the renewal risk. The hostname must stay proxied. Undo available."
    >
      <div className="flex flex-col items-end gap-1">
        <Button disabled>Start</Button>
        <span className="text-[11px] text-nd-text-muted">Coming in a later step</span>
      </div>
    </ActionRow>
  )
}

export function ActionsCard({ host, facts, run, onForce, onAddHttps }: ActionsCardProps) {
  const availability = actionAvailability(host, facts)
  const isThisCertificate = run.lineage !== null && run.lineage === host.lineage
  const shownAction = run.running ?? run.outcome?.action ?? null
  const showOutput = isThisCertificate && (run.running !== null || run.outcome !== null)
  return (
    <Card label="Actions" ariaLabel="Fix it">
      <div className="flex flex-col">
        {availability.allowed
          ? <CertbotRows host={host} facts={facts} run={run} />
          : host.lineage === null && isMissingServerCertificate(host)
            ? <AddHttpsRow host={host} onAddHttps={onAddHttps} />
            : <p className="py-2 text-[13px] text-nd-text-secondary">{availability.reason}</p>}
        <OriginCaRow />
      </div>
      {availability.allowed && (
        <button
          type="button"
          onClick={onForce}
          disabled={run.running !== null}
          className="self-start rounded text-xs text-nd-text-muted hover:text-nd-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent disabled:pointer-events-none disabled:opacity-50"
        >
          {FORCE_COPY.link}
        </button>
      )}
      {showOutput && shownAction && host.lineage && (
        <OutputPanel command={certbotCommand(host.lineage, shownAction)} output={run.output} running={run.running !== null} outcome={run.outcome} />
      )}
    </Card>
  )
}
