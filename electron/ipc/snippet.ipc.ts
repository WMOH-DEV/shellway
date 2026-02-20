import { ipcMain } from 'electron'
import { SnippetStore, type StoredSnippet } from '../services/SnippetStore'

const snippetStore = new SnippetStore()

/**
 * Register all snippet-related IPC handlers.
 * Channels:
 *   snippet:getAll        → StoredSnippet[]
 *   snippet:create        → StoredSnippet
 *   snippet:update        → StoredSnippet | null
 *   snippet:delete        → boolean
 *   snippet:getCategories → string[]
 */
export function registerSnippetIPC(): void {
  ipcMain.handle('snippet:getAll', () => {
    return snippetStore.getAll()
  })

  ipcMain.handle('snippet:create', (_event, snippet: StoredSnippet) => {
    return snippetStore.create(snippet)
  })

  ipcMain.handle('snippet:update', (_event, id: string, updates: Partial<StoredSnippet>) => {
    return snippetStore.update(id, updates) ?? null
  })

  ipcMain.handle('snippet:delete', (_event, id: string) => {
    return snippetStore.delete(id)
  })

  ipcMain.handle('snippet:getCategories', () => {
    return snippetStore.getCategories()
  })
}
