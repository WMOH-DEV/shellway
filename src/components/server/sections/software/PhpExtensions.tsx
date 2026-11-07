import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SearchSelect } from '@/components/ui/SearchSelect'
import { extensionView, type ExtensionView } from '@/utils/server/software/phpView'
import type { PhpSite, PhpVersionFacts } from '@/utils/server/software/types'
import { SectionCard } from '../../kit'
import type { SoftwareState } from './useSoftware'

type ExtensionRun = (extension: string, op: 'install' | 'remove') => void

function InstalledChips({ view, onRun }: { view: ExtensionView; onRun: ExtensionRun }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {view.installed.map((name) => (
        <span key={name} className="inline-flex h-[22px] items-center gap-1 rounded-md bg-nd-success/12 pl-2 pr-1 font-mono text-xs text-nd-success-fg">
          {name}
          <button type="button" aria-label={`Remove ${name}`} onClick={() => onRun(name, 'remove')} className="rounded p-0.5 opacity-70 hover:bg-nd-surface-hover hover:opacity-100">
            <X size={11} />
          </button>
        </span>
      ))}
      {view.missing.map((item) => (
        <span key={item.extension} className="inline-flex h-[22px] items-center gap-1 rounded-md bg-nd-warning/12 pl-2 pr-1 font-mono text-xs text-nd-warning-fg">
          {item.extension}
          {item.packageSuffix && (
            <button type="button" aria-label={`Add ${item.extension}`} onClick={() => onRun(item.packageSuffix as string, 'install')} className="rounded p-0.5 hover:bg-nd-surface-hover">
              <Plus size={11} />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

function missingText(view: ExtensionView, sites: PhpSite[]): string {
  if (sites.length === 0) return 'No site uses this version yet.'
  if (view.missing.length === 0) return 'Every extension the sites ask for in composer.json is installed.'
  return view.missing.map((item) => `${item.sites.join(', ')} ${item.sites.length === 1 ? 'needs' : 'need'} ${item.extension}${item.packageSuffix ? '' : ', which has no package here'}.`).join(' ')
}

function AddExtension({ available, onAdd }: { available: string[]; onAdd(name: string): void }) {
  const [choice, setChoice] = useState('')
  if (available.length === 0) return null
  return (
    <div className="flex items-center gap-2">
      <SearchSelect
        value={choice}
        onChange={setChoice}
        options={available.map((name) => ({ value: name, label: name }))}
        aria-label="Extension to add"
        placeholder="Choose an extension"
        searchPlaceholder="Search extensions"
        mono
        className="h-7 w-48 rounded-[7px] border-nd-border px-2 text-xs"
      />
      <Button size="sm" disabled={!choice} onClick={() => onAdd(choice)}>Add extension</Button>
    </div>
  )
}

export function PhpExtensions({ target, sites, run }: { target: PhpVersionFacts; sites: PhpSite[]; run: SoftwareState['run'] }) {
  const view = extensionView(target, sites)
  const onRun: ExtensionRun = (extension, op) => run('software.php-extension', { version: target.version, extension, op })
  return (
    <SectionCard title={`Extensions · ${target.version}`} count={`${view.installed.length} installed`} aside={<AddExtension available={view.available} onAdd={(name) => onRun(name, 'install')} />}>
      <InstalledChips view={view} onRun={onRun} />
      <p className="text-xs text-nd-text-muted">{missingText(view, sites)}</p>
    </SectionCard>
  )
}
