import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { SearchSelect } from '@/components/ui/SearchSelect'
import { cn } from '@/utils/cn'
import { INI_KEYS, POOL_KEYS, sitesUsing, type IniKey, type PoolKey } from '@/utils/server/software/php'
import type { FpmPressure, PhpFacts, PhpVersionFacts, ServiceState } from '@/utils/server/software/types'
import { isValidIniValue, isValidPoolValue } from '@/utils/server/software/validate'
import { Chip, Notice, ProbeState, SectionCard } from '../../kit'
import type { ServerSectionContext } from '../types'
import { PhpExtensions } from './PhpExtensions'
import { SettingsCard } from './SettingsCard'
import type { SoftwareState } from './useSoftware'

const FPM_TEXT: Record<ServiceState, string> = { active: 'FPM running', inactive: 'FPM stopped', failed: 'FPM failed', activating: 'FPM starting', unknown: 'FPM status unknown' }

function fpmText(target: PhpVersionFacts): string {
  if (target.fpm) return FPM_TEXT[target.fpmState]
  return target.cli ? 'CLI only' : 'partly installed'
}

function AddVersion({ installable, run }: { installable: string[]; run: SoftwareState['run'] }) {
  const [choice, setChoice] = useState(installable[0] ?? '')
  if (installable.length === 0) return null
  return (
    <div className="flex items-center gap-2">
      <SearchSelect
        value={choice}
        onChange={setChoice}
        options={installable.map((version) => ({ value: version, label: `PHP ${version}` }))}
        aria-label="PHP version to add"
        mono
        className="h-7 w-32 rounded-[7px] border-nd-border px-2 text-xs"
      />
      <Button size="sm" onClick={() => run('software.install', { component: 'php', version: choice })}>Add version</Button>
    </div>
  )
}

interface VersionRowProps {
  target: PhpVersionFacts
  php: PhpFacts
  selected: boolean
  onSelect(): void
  run: SoftwareState['run']
}

function VersionRow({ target, php, selected, onSelect, run }: VersionRowProps) {
  const sites = sitesUsing(php, target.version).map((site) => site.name)
  const isDefault = php.cliDefault === target.version
  return (
    <div className={cn('grid grid-cols-[52px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[10px] px-3 py-2', selected && 'bg-nd-surface-raised')}>
      <button type="button" onClick={onSelect} className="text-left font-mono text-[13px] font-medium text-nd-text-primary">{target.version}</button>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-col items-start text-left">
        <span className="text-xs text-nd-text-secondary">{fpmText(target)}</span>
        <span className="truncate text-xs text-nd-text-muted">{sites.length > 0 ? sites.join(', ') : 'no sites'}</span>
      </button>
      {isDefault ? <Chip tone="info" dense>CLI default</Chip> : target.cli ? <Button size="sm" variant="ghost" onClick={() => run('software.php-cli-default', { version: target.version })}>Make default</Button> : <span />}
      {sites.length > 0 ? <Button size="sm" onClick={onSelect}>Manage</Button> : <Button size="sm" variant="ghost" onClick={() => run('software.remove', { component: 'php', version: target.version })}>Remove</Button>}
    </div>
  )
}

function IniCard({ target, run }: { target: PhpVersionFacts; run: SoftwareState['run'] }) {
  const values = target.ini as Partial<Record<IniKey, string>>
  const footnote = <>Applies with <span className="font-mono">systemctl reload php{target.version}-fpm</span> · backup kept</>
  return (
    <SettingsCard
      key={`ini-${target.version}-${target.override.sha256}`}
      title={`php.ini · ${target.version} FPM`}
      keys={INI_KEYS}
      values={values}
      choices={{ 'opcache.enable': ['0', '1'] }}
      isValid={isValidIniValue}
      footnote={footnote}
      onApply={(changed) => run('software.php-ini', { version: target.version, values: changed })}
    />
  )
}

function PressureNotice({ pressure }: { pressure: FpmPressure | undefined }) {
  if (!pressure || pressure.hits === 0) return null
  return <Notice tone="warning" title="Ran out of workers">PHP-FPM reached pm.max_children {pressure.hits} times in the recent log{pressure.last ? `, last at ${pressure.last}` : ''}. Raise max children if the server has free memory.</Notice>
}

function PoolCard({ target, pressure, run }: { target: PhpVersionFacts; pressure: FpmPressure | undefined; run: SoftwareState['run'] }) {
  const opcache = target.ini['opcache.enable'] === '1' ? `OPcache on · ${target.ini['opcache.memory_consumption'] || '?'} MB` : 'OPcache off'
  const clear = <Button size="sm" variant="ghost" onClick={() => run('software.opcache-reset', { version: target.version })}>Clear OPcache</Button>
  if (!target.poolFile) return <Notice tone="neutral" title="FPM pool">No www pool file was found for PHP {target.version}.</Notice>
  return (
    <div className="flex flex-col gap-2">
      <PressureNotice pressure={pressure} />
      <SettingsCard
        key={`pool-${target.version}-${target.poolFile.sha256}`}
        title={`FPM pool · ${target.version}`}
        keys={POOL_KEYS}
        values={target.pool as Partial<Record<PoolKey, string>>}
        choices={{ pm: ['dynamic', 'static', 'ondemand'] }}
        isValid={isValidPoolValue}
        footnote={<>{opcache} · tested with <span className="font-mono">php-fpm{target.version} -t</span></>}
        aside={clear}
        onApply={(changed) => run('software.php-fpm-pool', { version: target.version, settings: changed })}
      />
    </div>
  )
}

function InstallPhp({ php, run }: { php: PhpFacts; run: SoftwareState['run'] }) {
  return (
    <SectionCard title="PHP" aside={<AddVersion installable={php.installable} run={run} />}>
      <p className="text-[13px] text-nd-text-muted">PHP is not installed.{php.installable.length === 0 ? ' No PHP packages were found in the package sources.' : ''}</p>
    </SectionCard>
  )
}

function selectedVersion(php: PhpFacts, wanted: string | undefined): PhpVersionFacts | undefined {
  return php.versions.find((item) => item.version === wanted) ?? php.versions.find((item) => item.version === php.cliDefault) ?? php.versions[0]
}

function PhpDetail({ php, ctx, state }: { php: PhpFacts; ctx: ServerSectionContext; state: SoftwareState }) {
  if (!php.installed) return <InstallPhp php={php} run={state.run} />
  const target = selectedVersion(php, ctx.route.params?.version)
  const select = (version: string) => ctx.navigate({ section: 'software', sub: 'php', params: { version } })
  return (
    <div className="flex flex-col gap-3">
      <SectionCard title="PHP" count="FPM + CLI" aside={<AddVersion installable={php.installable} run={state.run} />}>
        <div className="flex flex-col gap-1">
          {php.versions.map((item) => <VersionRow key={item.version} target={item} php={php} selected={item.version === target?.version} onSelect={() => select(item.version)} run={state.run} />)}
        </div>
      </SectionCard>
      {target && (
        <>
          <PhpExtensions target={target} sites={sitesUsing(php, target.version)} run={state.run} />
          {target.fpm && <IniCard target={target} run={state.run} />}
          {target.fpm && <PoolCard target={target} pressure={state.usageData?.fpmPressure.find((item) => item.version === target.version)} run={state.run} />}
        </>
      )}
    </div>
  )
}

export function PhpPanel({ ctx, state }: { ctx: ServerSectionContext; state: SoftwareState }) {
  return <ProbeState result={state.php} label="PHP">{(php) => <PhpDetail php={php} ctx={ctx} state={state} />}</ProbeState>
}
