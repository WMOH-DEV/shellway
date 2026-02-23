import { useState, useCallback } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Upload, FileUp, Lock, AlertTriangle, Monitor, Database,
  Settings, Code2, KeyRound, Key, CheckCircle, Loader2,
  ChevronRight, SkipForward, Copy, Replace
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/utils/cn'

// ── Types ──

interface ImportDialogProps {
  open: boolean
  onClose: () => void
  onComplete: () => void
}

type ConflictMode = 'skip' | 'overwrite' | 'duplicate'

interface ParsedPayload {
  sessions: any[]
  sqlConfigs: any[]
  settings: any | null
  snippets: any[]
  hostKeys: any[]
  clientKeys: any[]
  groups: any[]
  snippetCategories: string[]
}

interface ParsedExport {
  format: string
  version: number
  exportedAt: number
  appVersion: string
  includesCredentials: boolean
  payload: ParsedPayload
}

interface ImportResults {
  sessions: { added: number; skipped: number; overwritten: number }
  sqlConfigs: { added: number; skipped: number; overwritten: number }
  settingsUpdated: boolean
  snippets: { added: number; skipped: number }
  hostKeys: { added: number; skipped: number }
  clientKeys: { added: number; skipped: number; overwritten: number }
}

type Step = 'file' | 'preview' | 'results'

// ── Component ──

export function ImportDialog({ open, onClose, onComplete }: ImportDialogProps) {
  // Step management
  const [step, setStep] = useState<Step>('file')

  // Step 1: File selection
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [fileError, setFileError] = useState('')
  const [unlocking, setUnlocking] = useState(false)

  // Step 2: Preview
  const [parsed, setParsed] = useState<ParsedExport | null>(null)
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set())
  const [importSessions, setImportSessions] = useState(true)
  const [importSqlConfigs, setImportSqlConfigs] = useState(true)
  const [importSettings, setImportSettings] = useState(true)
  const [importSnippets, setImportSnippets] = useState(true)
  const [importHostKeys, setImportHostKeys] = useState(true)
  const [importClientKeys, setImportClientKeys] = useState(true)
  const [conflictMode, setConflictMode] = useState<ConflictMode>('skip')
  const [importing, setImporting] = useState(false)

  // Step 3: Results
  const [results, setResults] = useState<ImportResults | null>(null)

  // ── Reset ──

  const resetState = useCallback(() => {
    setStep('file')
    setFileContent(null)
    setFileName('')
    setNeedsPassword(false)
    setPassword('')
    setFileError('')
    setUnlocking(false)
    setParsed(null)
    setSelectedSessions(new Set())
    setImportSessions(true)
    setImportSqlConfigs(true)
    setImportSettings(true)
    setImportSnippets(true)
    setImportHostKeys(true)
    setImportClientKeys(true)
    setConflictMode('skip')
    setImporting(false)
    setResults(null)
  }, [])

  const handleClose = useCallback(() => {
    resetState()
    onClose()
  }, [resetState, onClose])

  // ── Step 1: File picking ──

  const moveToParsed = useCallback((data: ParsedExport) => {
    setParsed(data)
    setSelectedSessions(new Set(data.payload.sessions.map((s: any) => s.id as string)))
    setNeedsPassword(false)
    setStep('preview')
  }, [])

  const tryParse = useCallback(async (content: string, pwd?: string) => {
    setFileError('')
    try {
      // Detect legacy format first (plain JSON array)
      try {
        const raw = JSON.parse(content)
        if (Array.isArray(raw)) {
          // Validate that items look like sessions (must have id, host, username)
          const validSessions = raw.filter(
            (item: any) =>
              item && typeof item === 'object' &&
              typeof item.id === 'string' &&
              typeof item.host === 'string' &&
              typeof item.username === 'string'
          )
          if (validSessions.length === 0 && raw.length > 0) {
            setFileError('File contains an array but items are not valid sessions.')
            return
          }
          const wrapped: ParsedExport = {
            format: 'shellway-export',
            version: 1,
            exportedAt: Date.now(),
            appVersion: 'legacy',
            includesCredentials: false,
            payload: {
              sessions: validSessions,
              sqlConfigs: [],
              settings: null,
              snippets: [],
              hostKeys: [],
              clientKeys: [],
              groups: [],
              snippetCategories: []
            }
          }
          moveToParsed(wrapped)
          return
        }
      } catch {
        // Not plain JSON — might be encrypted, continue to exportParse
      }

      const result = await window.novadeck.sessions.exportParse(content, pwd)

      if (!result.success) {
        const errMsg = result.error || 'Invalid file'
        if (errMsg.toLowerCase().includes('password') || errMsg.toLowerCase().includes('decrypt') || errMsg.toLowerCase().includes('encrypted')) {
          setNeedsPassword(true)
          if (!pwd) {
            setFileError('This file is encrypted. Enter the password to unlock.')
          } else {
            setFileError('Wrong password. Please try again.')
          }
        } else {
          setFileError(errMsg)
        }
        return
      }

      if (!result.data) {
        setFileError('File parsed but contained no data.')
        return
      }

      const data: ParsedExport = {
        format: result.data.format,
        version: result.data.version,
        exportedAt: result.data.exportedAt,
        appVersion: result.data.appVersion,
        includesCredentials: result.data.includesCredentials,
        payload: {
          sessions: result.data.payload.sessions as any[],
          sqlConfigs: result.data.payload.sqlConfigs as any[],
          settings: result.data.payload.settings,
          snippets: result.data.payload.snippets as any[],
          hostKeys: result.data.payload.hostKeys as any[],
          clientKeys: ((result.data.payload as any).clientKeys ?? []) as any[],
          groups: result.data.payload.groups as any[],
          snippetCategories: result.data.payload.snippetCategories
        }
      }

      moveToParsed(data)
    } catch (err) {
      const msg = String(err)
      if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('decrypt')) {
        setNeedsPassword(true)
        setFileError('This file is encrypted. Enter the password to unlock.')
      } else {
        setFileError(`Invalid file: ${msg}`)
      }
    }
  }, [moveToParsed])

  const handlePickFile = useCallback(async () => {
    setFileError('')
    try {
      const result = await window.novadeck.dialog.openFile({
        title: 'Select Backup File',
        properties: ['openFile'],
        filters: [
          { name: 'Shellway Backup', extensions: ['shellway', 'json'] }
        ]
      }) as { canceled: boolean; filePaths?: string[] }

      if (result.canceled || !result.filePaths?.[0]) return

      const filePath = result.filePaths[0]
      setFileName(filePath.split(/[\\/]/).pop() || filePath)

      const content = await window.novadeck.fs.readFile(filePath)
      setFileContent(content)

      // Try parsing without password first
      await tryParse(content)
    } catch (err) {
      setFileError(`Failed to read file: ${String(err)}`)
    }
  }, [tryParse])

  const handleUnlock = useCallback(async () => {
    if (!fileContent || !password) return
    setUnlocking(true)
    setFileError('')
    try {
      await tryParse(fileContent, password)
    } finally {
      setUnlocking(false)
    }
  }, [fileContent, password, tryParse])

  // ── Step 2: Selection helpers ──

  const toggleSession = useCallback((id: string) => {
    setSelectedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectAllSessions = useCallback(() => {
    if (!parsed) return
    setSelectedSessions(new Set(parsed.payload.sessions.map((s: any) => s.id as string)))
  }, [parsed])

  const deselectAllSessions = useCallback(() => {
    setSelectedSessions(new Set())
  }, [])

  // ── Step 2: Import handler ──

  const handleImport = useCallback(async () => {
    if (!parsed) return

    setImporting(true)
    try {
      const sessionsToImport = importSessions
        ? parsed.payload.sessions.filter((s: any) => selectedSessions.has(s.id))
        : []

      const payload = {
        ...parsed.payload,
        sessions: sessionsToImport,
        sqlConfigs: importSqlConfigs ? parsed.payload.sqlConfigs : [],
        settings: importSettings ? parsed.payload.settings : null,
        snippets: importSnippets ? parsed.payload.snippets : [],
        hostKeys: importHostKeys ? parsed.payload.hostKeys : [],
        clientKeys: importClientKeys ? parsed.payload.clientKeys : [],
      }

      const importOptions: Record<string, unknown> = {
        importSessions: importSessions && sessionsToImport.length > 0,
        importSQLConfigs: importSqlConfigs,
        importSettings: importSettings,
        importSnippets: importSnippets,
        importHostKeys: importHostKeys,
        importClientKeys: importClientKeys,
        conflictResolution: conflictMode,
        selectedSessionIds: null, // Already filtered in payload
      }

      const result = await window.novadeck.sessions.exportApply(payload, importOptions)

      if (!result.success || !result.data) {
        toast.error('Import failed', result.error || 'Unknown error')
        setImporting(false)
        return
      }

      setResults({
        sessions: result.data.sessions,
        sqlConfigs: result.data.sqlConfigs,
        settingsUpdated: result.data.settings,
        snippets: result.data.snippets,
        hostKeys: result.data.hostKeys,
        clientKeys: result.data.clientKeys ?? { added: 0, skipped: 0, overwritten: 0 },
      })
      setStep('results')
      onComplete()
    } catch (err) {
      toast.error('Import failed', String(err))
    } finally {
      setImporting(false)
    }
  }, [parsed, importSessions, selectedSessions, importSqlConfigs, importSettings, importSnippets, importHostKeys, importClientKeys, conflictMode, onComplete])

  const canImport =
    !importing &&
    (importSessions || importSqlConfigs || importSettings || importSnippets || importHostKeys || importClientKeys) &&
    (!importSessions || selectedSessions.size > 0)

  // ── Render ──

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Backup"
      maxWidth="max-w-2xl"
      closeOnBackdrop={!importing}
    >
      <div className="flex flex-col gap-4">
        {/* Step indicator */}
        <div className="flex items-center gap-2 text-2xs text-nd-text-muted">
          <span className={cn(step === 'file' && 'text-nd-accent font-semibold')}>1. Select File</span>
          <ChevronRight size={10} />
          <span className={cn(step === 'preview' && 'text-nd-accent font-semibold')}>2. Preview</span>
          <ChevronRight size={10} />
          <span className={cn(step === 'results' && 'text-nd-accent font-semibold')}>3. Results</span>
        </div>

        {/* ═══════ STEP 1: File Selection ═══════ */}
        {step === 'file' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-nd-border border-dashed p-6 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-nd-surface flex items-center justify-center">
                <FileUp size={24} className="text-nd-text-muted" />
              </div>
              <div className="text-center">
                <p className="text-xs text-nd-text-primary font-medium">
                  {fileName || 'Select a backup file to import'}
                </p>
                <p className="text-2xs text-nd-text-muted mt-1">
                  Supports .shellway and .json files
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={handlePickFile}>
                <Upload size={13} />
                Browse...
              </Button>
            </div>

            {fileError && (
              <div className="rounded-md bg-nd-error/10 border border-nd-error/20 px-3 py-2 flex items-start gap-2">
                <AlertTriangle size={14} className="text-nd-error shrink-0 mt-0.5" />
                <p className="text-2xs text-nd-error leading-relaxed">{fileError}</p>
              </div>
            )}

            {needsPassword && (
              <div className="rounded-lg border border-nd-border p-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Lock size={14} className="text-nd-accent" />
                  <span className="text-xs text-nd-text-primary font-medium">
                    This file is password-protected
                  </span>
                </div>
                <Input
                  type="password"
                  placeholder="Enter file password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUnlock()
                  }}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleUnlock}
                  disabled={!password || unlocking}
                  className="self-end"
                >
                  {unlocking ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      Unlocking...
                    </>
                  ) : (
                    <>
                      <Lock size={13} />
                      Unlock
                    </>
                  )}
                </Button>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* ═══════ STEP 2: Preview & Options ═══════ */}
        {step === 'preview' && parsed && (
          <div className="flex flex-col gap-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2">
              <SummaryCard icon={Monitor} label="Sessions" count={parsed.payload.sessions.length} />
              <SummaryCard icon={Database} label="SQL Configs" count={parsed.payload.sqlConfigs.length} />
              <SummaryCard icon={Settings} label="Settings" count={parsed.payload.settings ? 1 : 0} isBoolean />
              <SummaryCard icon={Code2} label="Snippets" count={parsed.payload.snippets.length} />
              <SummaryCard icon={KeyRound} label="Host Keys" count={parsed.payload.hostKeys.length} />
              <SummaryCard icon={Key} label="Client Keys" count={parsed.payload.clientKeys?.length ?? 0} />
            </div>

            {parsed.includesCredentials && (
              <div className="rounded-md bg-nd-accent/10 border border-nd-accent/20 px-3 py-1.5 flex items-center gap-2">
                <Lock size={12} className="text-nd-accent" />
                <span className="text-2xs text-nd-accent font-medium">
                  This backup includes credentials
                </span>
              </div>
            )}

            {/* Session list */}
            {parsed.payload.sessions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-nd-text-muted uppercase tracking-wider">
                    Sessions
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectAllSessions}
                      className="text-2xs text-nd-accent hover:underline"
                    >
                      Select All
                    </button>
                    <span className="text-2xs text-nd-text-muted">/</span>
                    <button
                      onClick={deselectAllSessions}
                      className="text-2xs text-nd-accent hover:underline"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-nd-border max-h-48 overflow-y-auto divide-y divide-nd-border">
                  {parsed.payload.sessions.map((session: any) => (
                    <label
                      key={session.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-nd-surface/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSessions.has(session.id)}
                        onChange={() => toggleSession(session.id)}
                        className="h-3.5 w-3.5 rounded border-nd-border text-nd-accent focus:ring-nd-accent bg-nd-surface"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-nd-text-primary font-medium truncate">
                            {session.name || `${session.username}@${session.host}`}
                          </span>
                          {session.group && (
                            <span className="text-2xs text-nd-text-muted bg-nd-surface px-1.5 py-0.5 rounded">
                              {session.group}
                            </span>
                          )}
                        </div>
                        <p className="text-2xs text-nd-text-muted truncate">
                          {session.username}@{session.host}{session.port && session.port !== 22 ? `:${session.port}` : ''}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="text-2xs text-nd-text-muted mt-1">
                  {selectedSessions.size} of {parsed.payload.sessions.length} selected
                </p>
              </div>
            )}

            {/* What to import */}
            <div>
              <h3 className="text-xs font-semibold text-nd-text-muted uppercase tracking-wider mb-2">
                What to import
              </h3>
              <div className="rounded-lg border border-nd-border divide-y divide-nd-border">
                {parsed.payload.sessions.length > 0 && (
                  <ImportCheckbox
                    icon={Monitor}
                    label="Sessions"
                    count={selectedSessions.size}
                    checked={importSessions}
                    onChange={setImportSessions}
                  />
                )}
                {parsed.payload.sqlConfigs.length > 0 && (
                  <ImportCheckbox
                    icon={Database}
                    label="Database connections"
                    count={parsed.payload.sqlConfigs.length}
                    checked={importSqlConfigs}
                    onChange={setImportSqlConfigs}
                  />
                )}
                {parsed.payload.settings && (
                  <ImportCheckbox
                    icon={Settings}
                    label="App settings"
                    checked={importSettings}
                    onChange={setImportSettings}
                  />
                )}
                {parsed.payload.snippets.length > 0 && (
                  <ImportCheckbox
                    icon={Code2}
                    label="Command snippets"
                    count={parsed.payload.snippets.length}
                    checked={importSnippets}
                    onChange={setImportSnippets}
                  />
                )}
                {parsed.payload.hostKeys.length > 0 && (
                  <ImportCheckbox
                    icon={KeyRound}
                    label="Trusted host keys"
                    count={parsed.payload.hostKeys.length}
                    checked={importHostKeys}
                    onChange={setImportHostKeys}
                  />
                )}
                {(parsed.payload.clientKeys?.length ?? 0) > 0 && (
                  <ImportCheckbox
                    icon={Key}
                    label="Client keys"
                    count={parsed.payload.clientKeys.length}
                    checked={importClientKeys}
                    onChange={setImportClientKeys}
                  />
                )}
              </div>
            </div>

            {/* Conflict resolution */}
            <div>
              <h3 className="text-xs font-semibold text-nd-text-muted uppercase tracking-wider mb-2">
                Conflict resolution
              </h3>
              <div className="rounded-lg border border-nd-border p-3 flex flex-col gap-2">
                <ConflictOption
                  icon={SkipForward}
                  value="skip"
                  label="Skip existing"
                  description="Keep existing items, only import new ones"
                  selected={conflictMode}
                  onChange={setConflictMode}
                />
                <ConflictOption
                  icon={Replace}
                  value="overwrite"
                  label="Overwrite existing"
                  description="Replace existing items with imported versions"
                  selected={conflictMode}
                  onChange={setConflictMode}
                />
                <ConflictOption
                  icon={Copy}
                  value="duplicate"
                  label="Import as duplicate"
                  description="Import all items, creating duplicates if needed"
                  selected={conflictMode}
                  onChange={setConflictMode}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" onClick={() => setStep('file')} disabled={importing}>
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={handleClose} disabled={importing}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleImport} disabled={!canImport}>
                  {importing ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload size={14} />
                      Import
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ STEP 3: Results ═══════ */}
        {step === 'results' && results && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-full bg-nd-success/10 flex items-center justify-center">
                <CheckCircle size={20} className="text-nd-success" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-nd-text-primary">Import Complete</h3>
                <p className="text-2xs text-nd-text-secondary">Your data has been imported successfully.</p>
              </div>
            </div>

            <div className="rounded-lg border border-nd-border divide-y divide-nd-border">
              <ResultRow
                icon={Monitor}
                label="Sessions"
                added={results.sessions.added}
                skipped={results.sessions.skipped}
                overwritten={results.sessions.overwritten}
              />
              <ResultRow
                icon={Database}
                label="SQL Configs"
                added={results.sqlConfigs.added}
                skipped={results.sqlConfigs.skipped}
                overwritten={results.sqlConfigs.overwritten}
              />
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Settings size={14} className="text-nd-text-muted shrink-0" />
                <span className="text-xs text-nd-text-primary flex-1">Settings</span>
                <span className={cn(
                  'text-2xs font-medium',
                  results.settingsUpdated ? 'text-nd-success' : 'text-nd-text-muted'
                )}>
                  {results.settingsUpdated ? 'Updated' : 'Not changed'}
                </span>
              </div>
              <ResultRowSimple
                icon={Code2}
                label="Snippets"
                added={results.snippets.added}
                skipped={results.snippets.skipped}
              />
              <ResultRowSimple
                icon={KeyRound}
                label="Host Keys"
                added={results.hostKeys.added}
                skipped={results.hostKeys.skipped}
              />
              <ResultRow
                icon={Key}
                label="Client Keys"
                added={results.clientKeys.added}
                skipped={results.clientKeys.skipped}
                overwritten={results.clientKeys.overwritten}
              />
            </div>

            <div className="flex justify-end pt-1">
              <Button variant="primary" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Sub-components ──

function SummaryCard({
  icon: Icon,
  label,
  count,
  isBoolean
}: {
  icon: LucideIcon
  label: string
  count: number
  isBoolean?: boolean
}) {
  return (
    <div className="rounded-lg border border-nd-border bg-nd-surface p-2.5 flex flex-col items-center gap-1.5 text-center">
      <Icon size={16} className="text-nd-text-muted" />
      <span className="text-sm font-semibold text-nd-text-primary tabular-nums">
        {isBoolean ? (count > 0 ? 'Yes' : 'No') : count}
      </span>
      <span className="text-2xs text-nd-text-muted leading-tight">{label}</span>
    </div>
  )
}

function ImportCheckbox({
  icon: Icon,
  label,
  count,
  checked,
  onChange
}: {
  icon: LucideIcon
  label: string
  count?: number
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-nd-surface/50 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-nd-border text-nd-accent focus:ring-nd-accent bg-nd-surface"
      />
      <Icon size={14} className="text-nd-text-muted shrink-0" />
      <span className="text-xs text-nd-text-primary flex-1">{label}</span>
      {count !== undefined && (
        <span className="text-2xs text-nd-text-muted tabular-nums">{count}</span>
      )}
    </label>
  )
}

function ConflictOption({
  icon: Icon,
  value,
  label,
  description,
  selected,
  onChange
}: {
  icon: LucideIcon
  value: ConflictMode
  label: string
  description: string
  selected: ConflictMode
  onChange: (v: ConflictMode) => void
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors',
        selected === value
          ? 'bg-nd-accent/10 border border-nd-accent/20'
          : 'hover:bg-nd-surface/50 border border-transparent'
      )}
    >
      <input
        type="radio"
        name="conflict-mode"
        checked={selected === value}
        onChange={() => onChange(value)}
        className="mt-0.5 h-3.5 w-3.5 border-nd-border text-nd-accent focus:ring-nd-accent bg-nd-surface"
      />
      <Icon size={14} className="text-nd-text-muted shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="text-xs text-nd-text-primary font-medium">{label}</span>
        <p className="text-2xs text-nd-text-muted">{description}</p>
      </div>
    </label>
  )
}

function ResultRow({
  icon: Icon,
  label,
  added,
  skipped,
  overwritten
}: {
  icon: LucideIcon
  label: string
  added: number
  skipped: number
  overwritten: number
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icon size={14} className="text-nd-text-muted shrink-0" />
      <span className="text-xs text-nd-text-primary flex-1">{label}</span>
      <div className="flex items-center gap-3 text-2xs tabular-nums">
        {added > 0 && (
          <span className="text-nd-success">{added} added</span>
        )}
        {skipped > 0 && (
          <span className="text-nd-text-muted">{skipped} skipped</span>
        )}
        {overwritten > 0 && (
          <span className="text-nd-warning">{overwritten} overwritten</span>
        )}
        {added === 0 && skipped === 0 && overwritten === 0 && (
          <span className="text-nd-text-muted">none</span>
        )}
      </div>
    </div>
  )
}

function ResultRowSimple({
  icon: Icon,
  label,
  added,
  skipped
}: {
  icon: LucideIcon
  label: string
  added: number
  skipped: number
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Icon size={14} className="text-nd-text-muted shrink-0" />
      <span className="text-xs text-nd-text-primary flex-1">{label}</span>
      <div className="flex items-center gap-3 text-2xs tabular-nums">
        {added > 0 && (
          <span className="text-nd-success">{added} added</span>
        )}
        {skipped > 0 && (
          <span className="text-nd-text-muted">{skipped} skipped</span>
        )}
        {added === 0 && skipped === 0 && (
          <span className="text-nd-text-muted">none</span>
        )}
      </div>
    </div>
  )
}
