import { contextBridge, ipcRenderer } from 'electron'

/**
 * Typed API exposed to the renderer process via `window.novadeck`.
 * All communication with the main process goes through here.
 */
const api = {
  // ── Window controls ──
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
      ipcRenderer.on('window:maximized-change', handler)
      return () => ipcRenderer.removeListener('window:maximized-change', handler)
    }
  },

  // ── Platform info ──
  platform: {
    get: () => ipcRenderer.invoke('platform:get') as Promise<NodeJS.Platform>
  },

  // ── Theme ──
  theme: {
    getNative: () => ipcRenderer.invoke('theme:getNative') as Promise<'dark' | 'light'>
  },

  // ── Sessions ──
  sessions: {
    getAll: () => ipcRenderer.invoke('session:getAll'),
    getById: (id: string) => ipcRenderer.invoke('session:getById', id),
    create: (session: unknown) => ipcRenderer.invoke('session:create', session),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('session:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id),
    deleteMany: (ids: string[]) => ipcRenderer.invoke('session:deleteMany', ids),
    touch: (id: string) => ipcRenderer.invoke('session:touch', id),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke('session:reorder', orderedIds),
    getGroups: () => ipcRenderer.invoke('session:getGroups') as Promise<string[]>,
    setGroups: (groups: string[]) => ipcRenderer.invoke('session:setGroups', groups),
    export: () => ipcRenderer.invoke('session:export'),
    import: (sessions: unknown[]) => ipcRenderer.invoke('session:import', sessions),

    // Advanced export/import (v2 — with encryption, SQL configs, settings, snippets, host keys)
    exportBuild: (options: Record<string, unknown>) =>
      ipcRenderer.invoke('export:build', options) as Promise<{ success: boolean; data?: string; error?: string }>,
    exportParse: (fileContent: string, password?: string) =>
      ipcRenderer.invoke('export:parse', fileContent, password) as Promise<{
        success: boolean; error?: string;
        data?: {
          format: string; version: number; exportedAt: number; appVersion: string;
          includesCredentials: boolean;
          payload: {
            sessions: unknown[]; sqlConfigs: unknown[]; settings: unknown;
            snippets: unknown[]; hostKeys: unknown[]; clientKeys: unknown[];
            groups: string[]; snippetCategories: string[];
          };
        };
      }>,
    exportApply: (payload: unknown, options: Record<string, unknown>) =>
      ipcRenderer.invoke('export:apply', payload, options) as Promise<{
        success: boolean; error?: string;
        data?: {
          sessions: { added: number; skipped: number; overwritten: number };
          sqlConfigs: { added: number; skipped: number; overwritten: number };
          settings: boolean;
          snippets: { added: number; skipped: number };
          hostKeys: { added: number; skipped: number };
          clientKeys: { added: number; skipped: number; overwritten: number };
        };
      }>
  },

  // ── Settings ──
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    update: (updates: unknown) => ipcRenderer.invoke('settings:update', updates),
    reset: () => ipcRenderer.invoke('settings:reset')
  },

  // ── Dialogs ──
  dialog: {
    openFile: (options: unknown) => ipcRenderer.invoke('dialog:openFile', options),
    saveFile: (options: unknown) => ipcRenderer.invoke('dialog:saveFile', options)
  },

  // ── File system (limited) ──
  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path) as Promise<string>,
    writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
    getTempDir: () => ipcRenderer.invoke('fs:getTempDir') as Promise<string>,
    watchFile: (watchId: string, filePath: string) =>
      ipcRenderer.invoke('fs:watchFile', watchId, filePath) as Promise<{ success: boolean }>,
    unwatchFile: (watchId: string) =>
      ipcRenderer.invoke('fs:unwatchFile', watchId) as Promise<{ success: boolean }>,
    onFileChanged: (callback: (watchId: string, filePath: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, watchId: string, filePath: string) =>
        callback(watchId, filePath)
      ipcRenderer.on('fs:file-changed', handler)
      return () => ipcRenderer.removeListener('fs:file-changed', handler)
    }
  },

  // ── Shell ──
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path) as Promise<string>,
    openFileWithApp: (filePath: string, appPath: string) =>
      ipcRenderer.invoke('shell:openFileWithApp', filePath, appPath) as Promise<{ success: boolean; error?: string }>,
    openWithPicker: (filePath: string) =>
      ipcRenderer.invoke('shell:openWithPicker', filePath) as Promise<{ appPath: string; appName: string } | null>
  },

  // ── SSH ──
  ssh: {
    connect: (connectionId: string, config: unknown) =>
      ipcRenderer.invoke('ssh:connect', connectionId, config) as Promise<{
        success: boolean
        error?: string
      }>,
    disconnect: (connectionId: string) => ipcRenderer.invoke('ssh:disconnect', connectionId),
    isConnected: (connectionId: string) =>
      ipcRenderer.invoke('ssh:isConnected', connectionId) as Promise<boolean>,
    disconnectAll: () => ipcRenderer.invoke('ssh:disconnectAll'),
    onStatusChange: (callback: (connectionId: string, status: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, status: string) =>
        callback(id, status)
      ipcRenderer.on('ssh:status-change', handler)
      return () => ipcRenderer.removeListener('ssh:status-change', handler)
    },
    onError: (callback: (connectionId: string, error: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, error: string) =>
        callback(id, error)
      ipcRenderer.on('ssh:error', handler)
      return () => ipcRenderer.removeListener('ssh:error', handler)
    },
    onBanner: (callback: (connectionId: string, message: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, message: string) =>
        callback(id, message)
      ipcRenderer.on('ssh:banner', handler)
      return () => ipcRenderer.removeListener('ssh:banner', handler)
    },

    // ── Reconnection control ──
    reconnectRetryNow: (connectionId: string) =>
      ipcRenderer.invoke('ssh:reconnect-retry-now', connectionId),
    reconnectPause: (connectionId: string) =>
      ipcRenderer.invoke('ssh:reconnect-pause', connectionId),
    reconnectResume: (connectionId: string) =>
      ipcRenderer.invoke('ssh:reconnect-resume', connectionId),
    reconnectCancel: (connectionId: string) =>
      ipcRenderer.invoke('ssh:reconnect-cancel', connectionId),
    onReconnectAttempt: (callback: (connectionId: string, attempt: number, maxAttempts: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, attempt: number, max: number) =>
        callback(id, attempt, max)
      ipcRenderer.on('ssh:reconnect-attempt', handler)
      return () => ipcRenderer.removeListener('ssh:reconnect-attempt', handler)
    },
    onReconnectWaiting: (callback: (connectionId: string, delayMs: number, nextAttempt: number, nextRetryAt: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, delayMs: number, nextAttempt: number, nextRetryAt: number) =>
        callback(id, delayMs, nextAttempt, nextRetryAt)
      ipcRenderer.on('ssh:reconnect-waiting', handler)
      return () => ipcRenderer.removeListener('ssh:reconnect-waiting', handler)
    },
    onReconnectSuccess: (callback: (connectionId: string, attempt: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, attempt: number) =>
        callback(id, attempt)
      ipcRenderer.on('ssh:reconnect-success', handler)
      return () => ipcRenderer.removeListener('ssh:reconnect-success', handler)
    },
    onReconnectFailed: (callback: (connectionId: string, attempt: number, error: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, attempt: number, error: string) =>
        callback(id, attempt, error)
      ipcRenderer.on('ssh:reconnect-failed', handler)
      return () => ipcRenderer.removeListener('ssh:reconnect-failed', handler)
    },
    onReconnectExhausted: (callback: (connectionId: string, totalAttempts: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, totalAttempts: number) =>
        callback(id, totalAttempts)
      ipcRenderer.on('ssh:reconnect-exhausted', handler)
      return () => ipcRenderer.removeListener('ssh:reconnect-exhausted', handler)
    },
    onReconnectPaused: (callback: (connectionId: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string) => callback(id)
      ipcRenderer.on('ssh:reconnect-paused', handler)
      return () => ipcRenderer.removeListener('ssh:reconnect-paused', handler)
    },
    onReconnectResumed: (callback: (connectionId: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string) => callback(id)
      ipcRenderer.on('ssh:reconnect-resumed', handler)
      return () => ipcRenderer.removeListener('ssh:reconnect-resumed', handler)
    },

    // ── Keyboard-interactive auth ──
    onKBDIPrompt: (callback: (connectionId: string, prompt: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, id: string, prompt: unknown) =>
        callback(id, prompt)
      ipcRenderer.on('ssh:kbdi-prompt', handler)
      return () => ipcRenderer.removeListener('ssh:kbdi-prompt', handler)
    },
    respondKBDI: (connectionId: string, responses: string[]) => {
      ipcRenderer.send(`ssh:kbdi-response:${connectionId}`, responses)
    }
  },

  // ── Terminal ──
  terminal: {
    open: (connectionId: string, shellId: string, options?: { cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:open', connectionId, shellId, options) as Promise<{
        success: boolean
        error?: string
      }>,
    write: (shellId: string, data: string) => ipcRenderer.invoke('terminal:write', shellId, data),
    resize: (shellId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', shellId, cols, rows),
    close: (shellId: string) => ipcRenderer.invoke('terminal:close', shellId),
    onData: (callback: (shellId: string, data: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, shellId: string, data: string) =>
        callback(shellId, data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    onExit: (callback: (shellId: string, code: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, shellId: string, code: number) =>
        callback(shellId, code)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    }
  },

  // ── SFTP ──
  sftp: {
    open: (connectionId: string) =>
      ipcRenderer.invoke('sftp:open', connectionId) as Promise<{ success: boolean; error?: string }>,
    close: (connectionId: string) => ipcRenderer.invoke('sftp:close', connectionId),
    readdir: (connectionId: string, path: string) =>
      ipcRenderer.invoke('sftp:readdir', connectionId, path) as Promise<{ success: boolean; data?: unknown[]; error?: string }>,
    stat: (connectionId: string, path: string) =>
      ipcRenderer.invoke('sftp:stat', connectionId, path),
    realpath: (connectionId: string, path: string) =>
      ipcRenderer.invoke('sftp:realpath', connectionId, path) as Promise<{ success: boolean; data?: string; error?: string }>,
    mkdir: (connectionId: string, path: string) =>
      ipcRenderer.invoke('sftp:mkdir', connectionId, path),
    unlink: (connectionId: string, path: string) =>
      ipcRenderer.invoke('sftp:unlink', connectionId, path),
    rmdir: (connectionId: string, path: string, recursive: boolean) =>
      ipcRenderer.invoke('sftp:rmdir', connectionId, path, recursive),
    rename: (connectionId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('sftp:rename', connectionId, oldPath, newPath),
    chmod: (connectionId: string, path: string, mode: number, recursive: boolean) =>
      ipcRenderer.invoke('sftp:chmod', connectionId, path, mode, recursive),
    readFile: (connectionId: string, path: string) =>
      ipcRenderer.invoke('sftp:readFile', connectionId, path) as Promise<{ success: boolean; data?: string; error?: string }>,
    writeFile: (connectionId: string, path: string, content: string) =>
      ipcRenderer.invoke('sftp:writeFile', connectionId, path, content),
    symlink: (connectionId: string, target: string, link: string) =>
      ipcRenderer.invoke('sftp:symlink', connectionId, target, link),
    download: (connectionId: string, transferId: string, remotePath: string, localPath: string, totalBytes: number) =>
      ipcRenderer.invoke('sftp:download', connectionId, transferId, remotePath, localPath, totalBytes),
    upload: (connectionId: string, transferId: string, localPath: string, remotePath: string, totalBytes: number) =>
      ipcRenderer.invoke('sftp:upload', connectionId, transferId, localPath, remotePath, totalBytes),
    transferPause: (connectionId: string, transferId: string) =>
      ipcRenderer.invoke('sftp:transfer-pause', connectionId, transferId),
    transferResume: (connectionId: string, transferId: string) =>
      ipcRenderer.invoke('sftp:transfer-resume', connectionId, transferId),
    transferCancel: (connectionId: string, transferId: string) =>
      ipcRenderer.invoke('sftp:transfer-cancel', connectionId, transferId),
    transferRetry: (connectionId: string, transferId: string) =>
      ipcRenderer.invoke('sftp:transfer-retry', connectionId, transferId),
    transferList: (connectionId: string) =>
      ipcRenderer.invoke('sftp:transfer-list', connectionId),
    localReaddir: (path: string) =>
      ipcRenderer.invoke('sftp:local-readdir', path) as Promise<{ success: boolean; data?: unknown[]; error?: string }>,
    localHomedir: () => ipcRenderer.invoke('sftp:local-homedir') as Promise<string>,
    onTransferUpdate: (callback: (connectionId: string, item: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, connId: string, item: unknown) =>
        callback(connId, item)
      ipcRenderer.on('sftp:transfer-update', handler)
      return () => ipcRenderer.removeListener('sftp:transfer-update', handler)
    },
    onTransferComplete: (callback: (connectionId: string, item: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, connId: string, item: unknown) =>
        callback(connId, item)
      ipcRenderer.on('sftp:transfer-complete', handler)
      return () => ipcRenderer.removeListener('sftp:transfer-complete', handler)
    }
  },

  // ── Activity Log ──
  log: {
    getEntries: (sessionId: string) =>
      ipcRenderer.invoke('log:getEntries', sessionId) as Promise<unknown[]>,
    clear: (sessionId: string) => ipcRenderer.invoke('log:clear', sessionId),
    export: (sessionId: string) =>
      ipcRenderer.invoke('log:export', sessionId) as Promise<string>,
    onEntry: (callback: (sessionId: string, entry: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, entry: unknown) =>
        callback(sessionId, entry)
      ipcRenderer.on('log:entry', handler)
      return () => ipcRenderer.removeListener('log:entry', handler)
    }
  },

  // ── Client Key Management ──
  clientkey: {
    getAll: () => ipcRenderer.invoke('clientkey:getAll') as Promise<unknown[]>,
    importFile: (filePath: string, name: string, passphrase?: string, savePassphrase?: boolean) =>
      ipcRenderer.invoke('clientkey:importFile', filePath, name, passphrase, savePassphrase) as Promise<{
        success: boolean; data?: unknown; error?: string
      }>,
    importData: (privateKeyData: string, name: string, passphrase?: string, savePassphrase?: boolean) =>
      ipcRenderer.invoke('clientkey:importData', privateKeyData, name, passphrase, savePassphrase) as Promise<{
        success: boolean; data?: unknown; error?: string
      }>,
    remove: (id: string) => ipcRenderer.invoke('clientkey:remove', id) as Promise<boolean>,
    update: (id: string, updates: { name?: string; comment?: string }) =>
      ipcRenderer.invoke('clientkey:update', id, updates) as Promise<boolean>,
    getPublicKey: (id: string) =>
      ipcRenderer.invoke('clientkey:getPublicKey', id) as Promise<string | null>
  },

  // ── Snippets ──
  snippets: {
    getAll: () => ipcRenderer.invoke('snippet:getAll'),
    create: (snippet: unknown) => ipcRenderer.invoke('snippet:create', snippet),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('snippet:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('snippet:delete', id),
    getCategories: () => ipcRenderer.invoke('snippet:getCategories') as Promise<string[]>
  },

  // ── Port Forwarding ──
  portforward: {
    add: (connectionId: string, rule: {
      id: string; type: 'local' | 'remote' | 'dynamic'; name?: string;
      sourceHost: string; sourcePort: number; destinationHost?: string; destinationPort?: number
    }) => ipcRenderer.invoke('portforward:add', connectionId, rule) as Promise<{
      success: boolean; data?: unknown; error?: string
    }>,
    remove: (connectionId: string, ruleId: string) =>
      ipcRenderer.invoke('portforward:remove', connectionId, ruleId) as Promise<boolean>,
    list: (connectionId: string) =>
      ipcRenderer.invoke('portforward:list', connectionId) as Promise<unknown[]>
  },

  // ── SQL Client ──
  sql: {
    connect: (sqlSessionId: string, connectionId: string, config: unknown) =>
      ipcRenderer.invoke('sql:connect', sqlSessionId, connectionId, config),
    disconnect: (sqlSessionId: string) =>
      ipcRenderer.invoke('sql:disconnect', sqlSessionId),
    query: (sqlSessionId: string, query: string, params?: unknown[]) =>
      ipcRenderer.invoke('sql:query', sqlSessionId, query, params),
    getDatabases: (sqlSessionId: string) =>
      ipcRenderer.invoke('sql:getDatabases', sqlSessionId),
    switchDatabase: (sqlSessionId: string, database: string) =>
      ipcRenderer.invoke('sql:switchDatabase', sqlSessionId, database),
    getTables: (sqlSessionId: string) =>
      ipcRenderer.invoke('sql:getTables', sqlSessionId),
    getColumns: (sqlSessionId: string, table: string, schema?: string) =>
      ipcRenderer.invoke('sql:getColumns', sqlSessionId, table, schema),
    getIndexes: (sqlSessionId: string, table: string, schema?: string) =>
      ipcRenderer.invoke('sql:getIndexes', sqlSessionId, table, schema),
    getForeignKeys: (sqlSessionId: string, table: string, schema?: string) =>
      ipcRenderer.invoke('sql:getForeignKeys', sqlSessionId, table, schema),
    getRowCount: (sqlSessionId: string, table: string, schema?: string) =>
      ipcRenderer.invoke('sql:getRowCount', sqlSessionId, table, schema),
    getPrimaryKeys: (sqlSessionId: string, table: string, schema?: string) =>
      ipcRenderer.invoke('sql:getPrimaryKeys', sqlSessionId, table, schema),
    isConnected: (sqlSessionId: string) =>
      ipcRenderer.invoke('sql:isConnected', sqlSessionId) as Promise<boolean>,

    // Saved configs (persist credentials per SSH session)
    configGet: (sessionId: string) =>
      ipcRenderer.invoke('sql:config:get', sessionId) as Promise<{ success: boolean; data?: Record<string, any>; error?: string }>,
    configSave: (config: Record<string, unknown>) =>
      ipcRenderer.invoke('sql:config:save', config) as Promise<{ success: boolean; error?: string }>,
    configDelete: (sessionId: string) =>
      ipcRenderer.invoke('sql:config:delete', sessionId) as Promise<{ success: boolean; error?: string }>,
    configGetStandalone: () =>
      ipcRenderer.invoke('sql:config:getStandalone') as Promise<{ success: boolean; data?: Record<string, any>[]; error?: string }>,

    // Data Transfer
    exportData: (sqlSessionId: string, filePath: string, options: unknown) =>
      ipcRenderer.invoke('sql:export', sqlSessionId, filePath, options),
    importSQL: (sqlSessionId: string, filePath: string, options: unknown) =>
      ipcRenderer.invoke('sql:import:sql', sqlSessionId, filePath, options),
    preScanSQL: (filePath: string) =>
      ipcRenderer.invoke('sql:import:sql-prescan', filePath),
    importCSV: (sqlSessionId: string, filePath: string, options: unknown) =>
      ipcRenderer.invoke('sql:import:csv', sqlSessionId, filePath, options),
    previewCSV: (filePath: string) =>
      ipcRenderer.invoke('sql:import:csv-preview', filePath),

    // Backup/Restore
    backup: (sqlSessionId: string, database: string, filePath: string, options: unknown) =>
      ipcRenderer.invoke('sql:backup', sqlSessionId, database, filePath, options),
    restore: (sqlSessionId: string, database: string, filePath: string, options: unknown) =>
      ipcRenderer.invoke('sql:restore', sqlSessionId, database, filePath, options),

    // Database management
    createDatabase: (sqlSessionId: string, options: unknown) =>
      ipcRenderer.invoke('sql:createDatabase', sqlSessionId, options),
    getCharsets: (sqlSessionId: string) =>
      ipcRenderer.invoke('sql:getCharsets', sqlSessionId),
    getCollations: (sqlSessionId: string, charset: string) =>
      ipcRenderer.invoke('sql:getCollations', sqlSessionId, charset),
    generateDDL: (sqlSessionId: string, table: string, schema?: string) =>
      ipcRenderer.invoke('sql:generateDDL', sqlSessionId, table, schema),
    executeStatements: (sqlSessionId: string, statements: string[]) =>
      ipcRenderer.invoke('sql:executeStatements', sqlSessionId, statements) as Promise<{
        success: boolean; error?: string; results?: { statement: string; success: boolean; error?: string }[];
        failedStatement?: string
      }>,

    // Transfer control
    cancelTransfer: (operationId: string) =>
      ipcRenderer.invoke('sql:transfer:cancel', operationId),
    onTransferProgress: (callback: (sqlSessionId: string, progress: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sqlSessionId: string, progress: unknown) =>
        callback(sqlSessionId, progress)
      ipcRenderer.on('sql:transfer:progress', handler)
      return () => ipcRenderer.removeListener('sql:transfer:progress', handler)
    },
  },

  // ── Health ──
  health: {
    getHealth: (connectionId: string) =>
      ipcRenderer.invoke('ssh:getHealth', connectionId) as Promise<{
        connectedAt: number
        latencyMs: number
        latencyHistory: number[]
        bytesIn: number
        bytesOut: number
        serverInfo: {
          serverVersion: string
          clientVersion: string
        }
      } | null>
  },

  // ── Server Monitor ──
  monitor: {
    start: (connectionId: string) =>
      ipcRenderer.invoke('monitor:start', connectionId) as Promise<{
        success: boolean; error?: string
      }>,
    stop: (connectionId: string) =>
      ipcRenderer.invoke('monitor:stop', connectionId) as Promise<{
        success: boolean
      }>,
    getHistory: (connectionId: string) =>
      ipcRenderer.invoke('monitor:getHistory', connectionId) as Promise<unknown[]>,
    getLatest: (connectionId: string) =>
      ipcRenderer.invoke('monitor:getLatest', connectionId) as Promise<unknown | null>,
    getStatus: (connectionId: string) =>
      ipcRenderer.invoke('monitor:getStatus', connectionId) as Promise<string>,
    killProcess: (connectionId: string, pid: number, signal?: number) =>
      ipcRenderer.invoke('monitor:killProcess', connectionId, pid, signal) as Promise<{
        success: boolean; error?: string
      }>,
    onData: (callback: (connectionId: string, snapshot: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, connId: string, snapshot: unknown) =>
        callback(connId, snapshot)
      ipcRenderer.on('monitor:data', handler)
      return () => ipcRenderer.removeListener('monitor:data', handler)
    },
    onStatus: (callback: (connectionId: string, status: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, connId: string, status: string) =>
        callback(connId, status)
      ipcRenderer.on('monitor:status', handler)
      return () => ipcRenderer.removeListener('monitor:status', handler)
    },
    onError: (callback: (connectionId: string, error: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, connId: string, error: string) =>
        callback(connId, error)
      ipcRenderer.on('monitor:error', handler)
      return () => ipcRenderer.removeListener('monitor:error', handler)
    }
  },

  // ── Host Key Management ──
  hostkey: {
    getAll: () => ipcRenderer.invoke('hostkey:getAll') as Promise<unknown[]>,
    remove: (id: string) => ipcRenderer.invoke('hostkey:remove', id),
    removeAllForHost: (host: string, port: number) =>
      ipcRenderer.invoke('hostkey:removeAllForHost', host, port),
    updateComment: (id: string, comment: string) =>
      ipcRenderer.invoke('hostkey:updateComment', id, comment),
    export: () => ipcRenderer.invoke('hostkey:export') as Promise<string>,
    import: (content: string) =>
      ipcRenderer.invoke('hostkey:import', content) as Promise<number>,
    onVerifyRequest: (
      callback: (
        connectionId: string,
        info: {
          host: string
          port: number
          keyType: string
          fingerprint: string
          publicKeyBase64: string
          status: 'new' | 'changed'
          previousFingerprint?: string
          previousTrustedAt?: number
        }
      ) => void
    ) => {
      const handler = (_e: Electron.IpcRendererEvent, connectionId: string, info: any) =>
        callback(connectionId, info)
      ipcRenderer.on('hostkey:verify-request', handler)
      return () => ipcRenderer.removeListener('hostkey:verify-request', handler)
    },
    respondVerify: (
      connectionId: string,
      response: { action: 'trust-once' | 'trust-save' | 'accept-new' | 'disconnect' }
    ) => {
      ipcRenderer.send(`hostkey:verify-response:${connectionId}`, response)
    }
  }
}

// Expose the typed API on window.novadeck
contextBridge.exposeInMainWorld('novadeck', api)

// Type declaration for the renderer
export type NovadeckAPI = typeof api
