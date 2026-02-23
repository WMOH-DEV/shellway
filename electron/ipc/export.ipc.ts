import { ipcMain } from 'electron'
import { ExportService } from '../services/ExportService'
import type { ExportOptions, ImportOptions, ShellwayExportPayload } from '../services/ExportService'
import { getSessionStore } from './session.ipc'
import { getSQLConfigStore } from './sql.ipc'
import { getSettingsStore } from './settings.ipc'
import { getSnippetStore } from './snippet.ipc'
import { getHostKeyStore } from './hostkey.ipc'
import { getClientKeyStore } from './clientkey.ipc'

let exportService: ExportService | null = null

function getExportService(): ExportService {
  if (!exportService) {
    exportService = new ExportService(
      getSessionStore(),
      getSQLConfigStore(),
      getSettingsStore(),
      getSnippetStore(),
      getHostKeyStore(),
      getClientKeyStore(),
    )
  }
  return exportService
}

// ── Input validation helpers ──

const VALID_CONFLICT_RESOLUTIONS = new Set(['skip', 'overwrite', 'duplicate'])
const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

function validateExportOptions(raw: unknown): ExportOptions | string {
  if (!raw || typeof raw !== 'object') return 'Invalid export options'
  const o = raw as Record<string, unknown>
  return {
    includeSessions: !!o.includeSessions,
    includeCredentials: !!o.includeCredentials,
    includeSQLConfigs: !!o.includeSQLConfigs,
    includeSettings: !!o.includeSettings,
    includeSnippets: !!o.includeSnippets,
    includeHostKeys: !!o.includeHostKeys,
    includeClientKeys: !!o.includeClientKeys,
    password: typeof o.password === 'string' ? o.password : undefined,
  }
}

function validateImportOptions(raw: unknown): ImportOptions | string {
  if (!raw || typeof raw !== 'object') return 'Invalid import options'
  const o = raw as Record<string, unknown>

  const resolution = typeof o.conflictResolution === 'string' ? o.conflictResolution : 'skip'
  if (!VALID_CONFLICT_RESOLUTIONS.has(resolution)) {
    return `Invalid conflict resolution: "${resolution}"`
  }

  return {
    importSessions: !!o.importSessions,
    importSQLConfigs: !!o.importSQLConfigs,
    importSettings: !!o.importSettings,
    importSnippets: !!o.importSnippets,
    importHostKeys: !!o.importHostKeys,
    importClientKeys: !!o.importClientKeys,
    conflictResolution: resolution as 'skip' | 'overwrite' | 'duplicate',
    selectedSessionIds: Array.isArray(o.selectedSessionIds) ? o.selectedSessionIds : null,
  }
}

function validatePayloadShape(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'Invalid payload: expected an object'
  const p = raw as Record<string, unknown>
  if (!Array.isArray(p.sessions)) return 'Invalid payload: "sessions" must be an array'
  if (!Array.isArray(p.sqlConfigs)) return 'Invalid payload: "sqlConfigs" must be an array'
  if (!Array.isArray(p.snippets)) return 'Invalid payload: "snippets" must be an array'
  if (!Array.isArray(p.hostKeys)) return 'Invalid payload: "hostKeys" must be an array'
  if (!Array.isArray(p.groups)) return 'Invalid payload: "groups" must be an array'
  if (!Array.isArray(p.snippetCategories)) return 'Invalid payload: "snippetCategories" must be an array'
  // clientKeys is optional for backward compatibility with older exports
  if (p.clientKeys !== undefined && !Array.isArray(p.clientKeys)) return 'Invalid payload: "clientKeys" must be an array'
  return null
}

/**
 * Register export/import IPC handlers.
 * Channels:
 *   export:build   → ShellwayExportFile (JSON string ready to save)
 *   export:parse   → ParsedImport (parse + validate + decrypt)
 *   export:apply   → ImportResult (apply parsed import to stores)
 */
export function registerExportIPC(): void {
  ipcMain.handle(
    'export:build',
    (_event, rawOptions: unknown) => {
      try {
        const options = validateExportOptions(rawOptions)
        if (typeof options === 'string') {
          return { success: false, error: options }
        }
        const file = getExportService().buildExport(options)
        return { success: true, data: JSON.stringify(file, null, 2) }
      } catch (err: any) {
        return { success: false, error: err.message || String(err) }
      }
    }
  )

  ipcMain.handle(
    'export:parse',
    (_event, fileContent: unknown, password?: string) => {
      try {
        if (typeof fileContent !== 'string') {
          return { success: false, error: 'File content must be a string' }
        }
        if (fileContent.length > MAX_IMPORT_FILE_SIZE) {
          return { success: false, error: 'File is too large (max 50 MB)' }
        }
        return getExportService().parseImport(fileContent, password)
      } catch (err: any) {
        return { success: false, error: err.message || String(err) }
      }
    }
  )

  ipcMain.handle(
    'export:apply',
    (_event, rawPayload: unknown, rawOptions: unknown) => {
      try {
        // Validate options
        const options = validateImportOptions(rawOptions)
        if (typeof options === 'string') {
          return { success: false, error: options }
        }

        // Validate payload shape
        const payloadError = validatePayloadShape(rawPayload)
        if (payloadError) {
          return { success: false, error: payloadError }
        }

        const result = getExportService().applyImport(rawPayload as ShellwayExportPayload, options)
        return { success: true, data: result }
      } catch (err: any) {
        return { success: false, error: err.message || String(err) }
      }
    }
  )
}
