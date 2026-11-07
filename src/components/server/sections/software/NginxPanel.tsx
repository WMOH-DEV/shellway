import { Button } from '@/components/ui/Button'
import { NGINX_DEFAULTS, NGINX_KEYS } from '@/utils/server/software/nginx'
import type { CatalogEntry, NginxFacts, PackagesFacts } from '@/utils/server/software/types'
import { isValidNginxValue } from '@/utils/server/software/validate'
import { ProbeState, SectionCard } from '../../kit'
import { Actions, ComponentFacts, InstallCard, rowFor } from './ComponentPanels'
import { SettingsCard } from './SettingsCard'
import type { SoftwareState } from './useSoftware'

const control = (verb: 'reload' | 'restart') => ({ kind: 'systemd', name: 'nginx', verb, user: null })

function ServerControls({ run }: { run: SoftwareState['run'] }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => run('software.nginx-test', {})}>Test config</Button>
      <Button size="sm" onClick={() => run('services.control', control('reload'))}>Reload</Button>
      <Button size="sm" variant="ghost" onClick={() => run('services.control', control('restart'))}>Restart</Button>
    </div>
  )
}

function IncludedSettings({ elsewhere }: { elsewhere: NginxFacts['elsewhere'] }) {
  const entries = Object.entries(elsewhere)
  if (entries.length === 0) return null
  return (
    <>
      {entries.map(([key, setting]) => (
        <span key={key} className="block">
          <span className="font-mono text-nd-text-secondary">{key} {setting.value}</span> is set in <span className="font-mono">{setting.path}</span>. Change it there.
        </span>
      ))}
    </>
  )
}

function NginxSettings({ nginx, run }: { nginx: NginxFacts; run: SoftwareState['run'] }) {
  const editable = NGINX_KEYS.filter((key) => !nginx.elsewhere[key])
  const footnote = <>Backed up, tested with <span className="font-mono">nginx -t</span>, reloaded, and restored if the test fails</>
  return (
    <SettingsCard
      key={`nginx-${nginx.conf.sha256}`}
      title="nginx.conf · http"
      keys={editable}
      values={{ ...NGINX_DEFAULTS, ...nginx.values }}
      choices={{ gzip: ['on', 'off'], server_tokens: ['on', 'off'] }}
      isValid={isValidNginxValue}
      footnote={<span className="flex flex-col gap-2"><IncludedSettings elsewhere={nginx.elsewhere} /><span>{footnote}</span></span>}
      onApply={(changed) => run('software.nginx-settings', { values: changed })}
    />
  )
}

interface NginxPanelProps {
  entry: CatalogEntry
  packages: PackagesFacts
  state: SoftwareState
}

export function NginxPanel({ entry, packages, state }: NginxPanelProps) {
  const row = rowFor(entry, packages, state)
  if (!row.installed) return <InstallCard entry={entry} run={state.run} />
  return (
    <div className="flex flex-col gap-3">
      <SectionCard title={entry.name} aside={<Actions row={row} run={state.run} />}>
        <ComponentFacts row={row} />
        <ServerControls run={state.run} />
      </SectionCard>
      <ProbeState result={state.nginx} label="nginx settings">{(nginx) => (nginx.installed ? <NginxSettings nginx={nginx} run={state.run} /> : null)}</ProbeState>
    </div>
  )
}
