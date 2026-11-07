import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ServerCheck } from '@/components/deploy/ServerCheck'
import { SiteForm } from '@/components/deploy/SiteForm'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import { vhostFor } from '@/utils/server/sites/inventory'
import { siteFile } from '@/utils/server/sites/join'
import { phpVersionIn, vhostServer } from '@/utils/server/sites/vhost'
import { useActionLauncher } from '../../../action'
import { CodeBox, Label, Notice, SectionCard } from '../../../kit'
import type { SitePageProps } from '../SiteDetailPage'
import { runForSite } from '../useCreateRuns'

function PhpVersionCard({ page }: { page: SitePageProps }) {
  const { ctx, data, entry } = page
  const launcher = useActionLauncher(ctx)
  const file = siteFile(entry)
  const vhost = file ? vhostFor(data.inventory, file) : undefined
  const current = vhost ? phpVersionIn(vhost.content) : null
  const versions = data.inventory?.fpmVersions ?? []
  const [version, setVersion] = useState(current ?? versions[0] ?? '')

  if (!data.inventory) return <Notice tone="neutral" title="PHP version is unavailable">{data.facts.error ?? 'Shellway is still reading the site files.'}</Notice>
  if (!current || !file) return null

  const switchVersion = () => launcher.launch({ type: 'sites.php-version', params: { vhost: file, version }, onFinished: () => void data.facts.refresh() })
  return (
    <SectionCard title="PHP version">
      <p className="text-[13px] text-nd-text-muted">This site runs on PHP {current} through PHP-FPM. Switching edits the socket in the site file, tests the config and reloads the web server.</p>
      <div className="flex items-center gap-2">
        <select
          aria-label="PHP version"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="h-8 rounded-md border border-nd-border-hover bg-nd-bg-sunken px-2 font-mono text-[13px] text-nd-text-primary"
        >
          {versions.map((v) => <option key={v} value={v}>PHP {v}{v === current ? ' (current)' : ''}</option>)}
        </select>
        <Button variant="primary" onClick={switchVersion} disabled={version === current}>Switch</Button>
      </div>
      {versions.length <= 1 && <span className="text-xs text-nd-text-muted">Install another PHP version in Software to switch.</span>}
    </SectionCard>
  )
}

function WebServerCard({ page }: { page: SitePageProps }) {
  const { data, entry } = page
  const file = siteFile(entry)
  if (!file) return null
  const vhost = vhostFor(data.inventory, file)
  const server = vhostServer(vhost?.realPath ?? file)
  return (
    <SectionCard title="Web server">
      <div className="flex flex-col gap-1">
        <Label>{server?.kind === 'apache' ? 'Apache site file' : 'nginx site file'}</Label>
        <span className="font-mono text-xs text-nd-text-secondary">{vhost && vhost.realPath !== file ? `${file} → ${vhost.realPath}` : file}</span>
      </div>
      {vhost ? <CodeBox text={vhost.content} label="site file" /> : <span className="text-xs text-nd-text-muted">The file contents are not available yet.</span>}
    </SectionCard>
  )
}

function DangerCard({ page }: { page: SitePageProps }) {
  const { ctx, entry, runs, createRuns } = page
  const { name } = entry.summary.config
  const created = runForSite(createRuns.runs, name)
  return (
    <SectionCard title="Remove">
      <div className="flex items-center gap-3">
        <p className="flex-1 text-[13px] text-nd-text-muted">Stop deploying this site and delete its settings, history and deploy key. The code on the server stays.</p>
        <Button variant="danger" onClick={() => runs.askRemove(true)}><Trash2 size={13} /> Remove from Shellway</Button>
      </div>
      {created && (
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[13px] text-nd-text-muted">Create site made this site. Remove the folder, web server site, DNS records and certificate it created.</p>
          <Button variant="danger" onClick={() => ctx.navigate({ section: 'sites', sub: 'create', params: { run: created.id } })}>Review what it created</Button>
        </div>
      )}
    </SectionCard>
  )
}

export function SettingsTab({ page }: { page: SitePageProps }) {
  const { data, entry, check } = page
  const { config } = entry.summary
  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Deploy settings">
        <SiteForm
          connectionId={data.connectionId}
          initial={config}
          existingNames={[]}
          onSaved={(site) => { toast.success(`${site.name} saved`); void data.deploy.refresh() }}
          onCancel={() => page.openTab('overview')}
        />
      </SectionCard>
      <PhpVersionCard page={page} />
      <WebServerCard page={page} />
      <SectionCard title="Server check">
        <ServerCheck site={config} check={check} />
      </SectionCard>
      <DangerCard page={page} />
    </div>
  )
}
