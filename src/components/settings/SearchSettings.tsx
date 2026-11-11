import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { toast } from '@/components/ui/Toast'
import { clearSearchCache } from '@/search/cacheClient'
import type { ScopeId } from '@/search/types'
import type { AppSettings } from '@/types/settings'
import type { SearchCacheStats } from '@/types/search'

type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void

interface SearchSettingsProps {
  settings: AppSettings
  update: UpdateSetting
}

const SCOPE_OPTIONS: { id: ScopeId; label: string }[] = [
  { id: 'servers', label: 'Servers' },
  { id: 'tables', label: 'Tables' },
  { id: 'queries', label: 'Queries' },
  { id: 'files', label: 'Files' },
  { id: 'commands', label: 'Commands' },
  { id: 'sites', label: 'Sites' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' }
]

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB']

export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`
}

function GroupTitle({ children }: { children: string }) {
  return <h3 className="mb-4 text-sm font-semibold text-nd-text-primary">{children}</h3>
}

export function SearchSettings({ settings, update }: SearchSettingsProps) {
  const [stats, setStats] = useState<SearchCacheStats | null>(null)
  const [confirming, setConfirming] = useState(false)
  const disabled = settings.searchDisabledScopes

  const refreshStats = useCallback(async () => {
    try {
      setStats(await window.novadeck.search.cacheStats())
    } catch {
      setStats(null)
    }
  }, [])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  const toggleScope = (id: ScopeId, enabled: boolean) => {
    const rest = disabled.filter((scope) => scope !== id)
    update('searchDisabledScopes', enabled ? rest : [...rest, id])
  }

  const clearIndex = async () => {
    setConfirming(false)
    try {
      await clearSearchCache()
      toast.success('Search index cleared')
    } catch {
      toast.error('Could not clear the search index')
    }
    await refreshStats()
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <GroupTitle>Search in</GroupTitle>
        <div className="flex flex-col gap-3">
          {SCOPE_OPTIONS.map((scope) => (
            <Toggle
              key={scope.id}
              checked={!disabled.includes(scope.id)}
              onChange={(enabled) => toggleScope(scope.id, enabled)}
              label={scope.label}
              ariaLabel={`Search ${scope.label}`}
            />
          ))}
        </div>
      </div>

      <div>
        <GroupTitle>Excluded folders</GroupTitle>
        <Input
          label="Skipped when searching text in files"
          value={settings.searchExcludeGlobs}
          onChange={(e) => update('searchExcludeGlobs', e.target.value)}
          placeholder="vendor, node_modules, storage, .git"
          spellCheck={false}
        />
      </div>

      <div>
        <GroupTitle>Search index</GroupTitle>
        <div className="flex items-center gap-3 rounded-lg border border-nd-border/50 bg-nd-surface/50 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-nd-text-primary">
              {stats ? `${stats.entries.toLocaleString('en-US')} entries · ${formatBytes(stats.bytes)}` : 'Index size unavailable'}
            </p>
            <p className="mt-0.5 text-2xs leading-relaxed text-nd-text-muted">
              Only names are stored: tables, columns, sites, services and folders you opened. Never passwords, file contents or query results.
            </p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
            Clear search index
          </Button>
        </div>
      </div>

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Clear search index" maxWidth="max-w-sm">
        <p className="text-sm text-nd-text-secondary">
          This removes the saved names and usage history. They are rebuilt as you use the app.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={clearIndex}>
            Clear
          </Button>
        </div>
      </Modal>
    </div>
  )
}
