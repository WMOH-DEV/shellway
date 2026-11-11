import type { ScopeId, SearchProvider } from '../types'

export function createProviders(): SearchProvider[] {
  return []
}

export function enabledProviders(providers: SearchProvider[], _disabledScopes: ScopeId[]): SearchProvider[] {
  return providers
}
