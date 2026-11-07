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

function NginxSettings({ nginx, run }: { nginx: NginxFacts; run: SoftwareState['run'] }) {
  return (
    <SettingsCard
      key={`nginx-${nginx.conf.sha256}`}
      title="nginx.conf · http"
      keys={NGINX_KEYS}
      values={{ ...NGINX_DEFAULTS, ...nginx.values }}
      choices={{ gzip: ['on', 'off'], server_tokens: ['on', 'off'] }}
      isValid={isValidNginxValue}
      footnote={<>Backed up, tested with <span className="font-mono">nginx -t</span>, reloaded, and restored if the test fails</>}
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
