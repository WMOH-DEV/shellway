import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { PackageHit } from '@/utils/server/software/types'
import { Chip } from '../../kit'
import { serverApi } from '../../serverApi'
import type { SoftwareState } from './useSoftware'

const DEBOUNCE_MS = 400
const MIN_LENGTH = 3

type SearchState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; hits: PackageHit[] } | { kind: 'error'; message: string }

function useDebouncedSearch(connectionId: string, query: string): SearchState {
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  const latest = useRef('')
  useEffect(() => {
    const trimmed = query.trim()
    latest.current = trimmed
    if (trimmed.length < MIN_LENGTH) return setState({ kind: 'idle' })
    const timer = setTimeout(async () => {
      setState({ kind: 'loading' })
      const result = await serverApi().software.search(connectionId, trimmed)
      if (latest.current !== trimmed) return
      setState(result.success ? { kind: 'done', hits: result.data } : { kind: 'error', message: result.error })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [connectionId, query])
  return state
}

function HitRow({ hit, onInstall }: { hit: PackageHit; onInstall(): void }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2.5 py-2 hover:bg-nd-surface-hover">
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-[12.5px] text-nd-text-primary">{hit.name}</span>
        <span className="truncate text-xs text-nd-text-muted">{hit.description}</span>
      </span>
      {hit.installed ? <Chip tone="success" dense>Installed</Chip> : <Button size="sm" onClick={onInstall}>Install</Button>}
    </li>
  )
}

function Results({ state, onInstall }: { state: SearchState; onInstall(name: string): void }) {
  if (state.kind === 'idle') return null
  return (
    <div className="absolute right-0 top-full z-20 mt-1.5 w-[440px] rounded-xl border border-nd-border bg-nd-surface p-1.5 shadow-lg">
      {state.kind === 'loading' && <div className="flex items-center justify-center gap-2 px-2.5 py-3 text-[13px] text-nd-text-muted"><Spinner size="sm" />Searching packages…</div>}
      {state.kind === 'error' && <p className="px-2.5 py-3 text-[13px] text-nd-error-fg">{state.message}</p>}
      {state.kind === 'done' && state.hits.length === 0 && <p className="px-2.5 py-3 text-[13px] text-nd-text-muted">No packages match.</p>}
      {state.kind === 'done' && state.hits.length > 0 && (
        <ul className="flex max-h-80 flex-col overflow-y-auto">
          {state.hits.map((hit) => <HitRow key={hit.name} hit={hit} onInstall={() => onInstall(hit.name)} />)}
        </ul>
      )}
    </div>
  )
}

export function PackageSearch({ connectionId, run }: { connectionId: string; run: SoftwareState['run'] }) {
  const [query, setQuery] = useState('')
  const state = useDebouncedSearch(connectionId, query)
  return (
    <div className="relative">
      <label className="flex h-[34px] w-[300px] items-center gap-2 rounded-[7px] border border-nd-border bg-nd-bg-sunken px-2.5 text-nd-text-muted focus-within:border-nd-accent">
        <Search size={14} aria-hidden />
        <span className="sr-only">Search software</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
          placeholder="Search or install a package"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-nd-text-primary outline-none placeholder:text-nd-text-dim"
        />
      </label>
      <Results state={state} onInstall={(name) => run('software.apt-install', { package: name })} />
    </div>
  )
}
