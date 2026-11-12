import type { ScopeId, SearchProvider } from '../types'
import { createCommandsProvider } from './commands'
import { createDatabasesProvider } from './databases'
import { createFilesProvider } from './files'
import { createHistoryProvider } from './history'
import { createQueriesProvider } from './queries'
import { createRemoteFilesProvider } from './remoteFiles'
import { createServicesProvider } from './services'
import { createSessionsProvider } from './sessions'
import { createSettingsProvider } from './settings'
import { createSitesProvider } from './sites'
import { createSnippetsProvider } from './snippets'
import { createTablesProvider } from './tables'

export function createProviders(): SearchProvider[] {
  return [
    createSessionsProvider(),
    createDatabasesProvider(),
    createTablesProvider(),
    createQueriesProvider(),
    createHistoryProvider(),
    createFilesProvider(),
    createRemoteFilesProvider(),
    createSitesProvider(),
    createServicesProvider(),
    createSnippetsProvider(),
    createCommandsProvider(),
    createSettingsProvider()
  ]
}

export function enabledProviders(providers: SearchProvider[], disabledScopes: ScopeId[]): SearchProvider[] {
  return providers.filter((provider) => provider.scopes.some((scope) => !disabledScopes.includes(scope)))
}
