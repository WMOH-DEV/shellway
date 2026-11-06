import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import type { DoctorReport, SiteConfig } from '@/types/deploy'
import { sudoersLine } from '@/utils/deploy/sudoers'
import { deployApi } from './useDeploySites'

interface Check {
  ok: boolean
  label: string
  fix?: string
}

function checksFor(report: DoctorReport, site: SiteConfig): Check[] {
  const parent = site.path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
  const checks: Check[] = [
    { ok: report.git, label: 'git is installed', fix: 'Install git on the server' },
    { ok: report.curl || report.wget || !site.healthUrl, label: 'curl or wget is available for the health check', fix: 'Install curl' }
  ]
  if (site.sourceMode === 'auto') {
    checks.push({ ok: report.crontab, label: 'cron is available for automatic checks', fix: 'Install cron' })
    checks.push({ ok: report.deployKey, label: 'The server has its read-only deploy key', fix: 'Open Deploy key to create it' })
  }
  if (site.layout === 'releases' && report.sitePathKind !== 'symlink') {
    checks.push({
      ok: report.parentWritable,
      label: `${report.user} can write ${parent} (needed once to switch ${site.path} to releases)`,
      fix: `Allow it once, e.g. sudo setfacl -m u:${report.user}:rwx ${parent}, or switch this site to In place`
    })
  }
  if (site.layout === 'releases' && report.sitePathKind === 'foreign-symlink') {
    checks.push({ ok: false, label: `${site.path} is a symlink Shellway did not create`, fix: 'Remove or rename it before deploying' })
  }
  if (site.layout === 'inplace') {
    checks.push({ ok: report.siteWritable || report.sitePathKind === 'missing', label: `${report.user} can write ${site.path}`, fix: `sudo chown -R ${report.user} ${site.path}` })
  }
  return checks
}

export function ServerCheck({ connectionId, site }: { connectionId: string; site: SiteConfig }) {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setReport(null)
    setError(null)
    const result = await deployApi().doctor(connectionId, site.name)
    if (result.success && result.data) setReport(result.data)
    else setError(result.error ?? 'Could not check the server')
  }, [connectionId, site.name])

  useEffect(() => { void run() }, [run])

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 text-xs text-nd-error">
        {error}
        <Button size="sm" variant="ghost" onClick={() => void run()}>Try again</Button>
      </div>
    )
  }
  if (!report) return <div className="p-4 text-xs text-nd-text-muted">Checking the server…</div>

  const sudoLine = report.sudoNeeds.length > 0 ? sudoersLine(report.user, report.sudoNeeds) : ''
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    toast.success('Copied')
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-nd-text-secondary">Deploys run as <span className="font-mono">{report.user}</span></span>
        <Button size="sm" variant="ghost" onClick={() => void run()}>Run again</Button>
      </div>
      <ul className="flex flex-col gap-2">
        {checksFor(report, site).map((check) => (
          <li key={check.label} className="flex items-start gap-2 text-xs">
            {check.ok ? <Check size={13} className="mt-0.5 text-nd-success" /> : <X size={13} className="mt-0.5 text-nd-error" />}
            <div className="flex flex-col">
              <span className="text-nd-text-primary">{check.label}</span>
              {!check.ok && check.fix && <span className="font-mono text-2xs text-nd-text-muted">{check.fix}</span>}
            </div>
          </li>
        ))}
        {report.sudoOk.map((cmd) => (
          <li key={cmd} className="flex items-start gap-2 text-xs">
            <Check size={13} className="mt-0.5 text-nd-success" />
            <span className="text-nd-text-primary">Can run <span className="font-mono">sudo {cmd}</span> without a password</span>
          </li>
        ))}
      </ul>
      {sudoLine && (
        <div className="flex flex-col gap-1.5 rounded-md border border-nd-warning/40 bg-nd-warning/10 p-3">
          <span className="text-xs text-nd-warning">
            These commands would ask for a password, so they will fail during a deploy. Add this line with <span className="font-mono">sudo visudo -f /etc/sudoers.d/shellway-deploy</span>:
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-nd-bg-primary p-2 font-mono text-2xs text-nd-text-primary">{sudoLine}</code>
            <Button size="icon" variant="ghost" onClick={() => void copy(sudoLine)}><Copy size={13} /></Button>
          </div>
        </div>
      )}
    </div>
  )
}
