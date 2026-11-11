import type { ProviderId, ScopeId, SearchProvider, SearchQuery, SearchResult } from './types'

export interface ProviderUpdate {
  providerId: ProviderId
  results: SearchResult[]
  done: boolean
  timedOut?: boolean
  error?: string
}

export interface BrokerBudgets {
  localMs: number
  remoteMs: number
}

export const DEFAULT_BUDGETS: BrokerBudgets = { localMs: 300, remoteMs: 20_000 }

export function providerInScope(provider: SearchProvider, scope: ScopeId): boolean {
  if (scope === 'all') return provider.kind === 'local'
  return provider.scopes.includes(scope)
}

function linkedController(parent: AbortSignal): AbortController {
  const child = new AbortController()
  if (parent.aborted) child.abort()
  else parent.addEventListener('abort', () => child.abort(), { once: true })
  return child
}

const ABORTED = Symbol('aborted')

function abortPromise(signal: AbortSignal): Promise<typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED)
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(ABORTED), { once: true }))
}

async function runProvider(
  provider: SearchProvider,
  query: SearchQuery,
  signal: AbortSignal,
  budgetMs: number,
  onUpdate: (update: ProviderUpdate) => void
): Promise<void> {
  const controller = linkedController(signal)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, budgetMs)
  const results: SearchResult[] = []
  const emit = (update: Omit<ProviderUpdate, 'providerId' | 'results'>) => {
    if (!signal.aborted) onUpdate({ providerId: provider.id, results: [...results], ...update })
  }

  const iterator = provider.search(query, controller.signal)[Symbol.asyncIterator]()
  const aborted = abortPromise(controller.signal)

  try {
    for (;;) {
      const next = await Promise.race([iterator.next(), aborted])
      if (next === ABORTED || next.done) break
      results.push(...next.value)
      emit({ done: false })
    }
    if (controller.signal.aborted) void iterator.return?.()?.catch(() => {})
    emit({ done: true, timedOut })
  } catch (err) {
    emit(timedOut ? { done: true, timedOut } : { done: true, error: err instanceof Error ? err.message : String(err) })
  } finally {
    clearTimeout(timer)
  }
}

export function runSearch(
  query: SearchQuery,
  providers: SearchProvider[],
  signal: AbortSignal,
  onUpdate: (update: ProviderUpdate) => void,
  budgets: BrokerBudgets = DEFAULT_BUDGETS
): Promise<void> {
  const active = providers.filter((p) => providerInScope(p, query.scope))
  return Promise.all(
    active.map((p) => runProvider(p, query, signal, p.kind === 'local' ? budgets.localMs : budgets.remoteMs, onUpdate))
  ).then(() => undefined)
}
