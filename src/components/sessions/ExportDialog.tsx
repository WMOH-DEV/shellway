import { useState, useCallback, useEffect } from 'react'
import {
  Download, Monitor, Database, Settings, Code2, KeyRound, Key,
  ShieldAlert, Lock, AlertTriangle, Loader2
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { toast } from '@/components/ui/Toast'

// ── Types ──

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

interface ExportCounts {
  sessions: number
  sqlConfigs: number
  snippets: number
  hostKeys: number
  clientKeys: number
}

// ── Helpers ──

function formatDate(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ── Component ──

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  // What to export
  const [sessions, setSessions] = useState(true)
  const [sqlConfigs, setSqlConfigs] = useState(true)
  const [settings, setSettings] = useState(true)
  const [snippets, setSnippets] = useState(true)
  const [hostKeys, setHostKeys] = useState(true)
  const [clientKeys, setClientKeys] = useState(true)

  // Security
  const [includeCredentials, setIncludeCredentials] = useState(false)
  const [passwordProtect, setPasswordProtect] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Counts (loaded when dialog opens)
  const [counts, setCounts] = useState<ExportCounts | null>(null)

  // State
  const [exporting, setExporting] = useState(false)

  // Load counts when opened
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const loadCounts = async () => {
      try {
        const result = await window.novadeck.sessions.exportBuild({
          includeSessions: true,
          includeSQLConfigs: true,
          includeSettings: true,
          includeSnippets: true,
          includeHostKeys: true,
          includeClientKeys: true,
          includeCredentials: false,
        })
        if (cancelled) return
        if (result.success && result.data) {
          const parsed = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
          if (parsed?.payload) {
            setCounts({
              sessions: parsed.payload.sessions?.length ?? 0,
              sqlConfigs: parsed.payload.sqlConfigs?.length ?? 0,
              snippets: parsed.payload.snippets?.length ?? 0,
              hostKeys: parsed.payload.hostKeys?.length ?? 0,
              clientKeys: parsed.payload.clientKeys?.length ?? 0,
            })
          }
        }
      } catch {
        // Counts are optional — dialog still works without them
      }
    }

    loadCounts()
    return () => { cancelled = true }
  }, [open])

  // Handle credentials toggle
  const handleCredentialsChange = useCallback((checked: boolean) => {
    setIncludeCredentials(checked)
    if (checked) {
      setPasswordProtect(true)
    }
  }, [])

  // Validation
  const passwordError = passwordProtect && password.length > 0 && password.length < 4
    ? 'Minimum 4 characters'
    : undefined

  const confirmError = passwordProtect && confirmPassword.length > 0 && password !== confirmPassword
    ? 'Passwords do not match'
    : undefined

  const canExport =
    (sessions || sqlConfigs || settings || snippets || hostKeys || clientKeys) &&
    !exporting &&
    (!passwordProtect || (password.length >= 4 && password === confirmPassword))

  // Export handler
  const handleExport = useCallback(async () => {
    if (!canExport) return

    setExporting(true)
    try {
      const options: Record<string, unknown> = {
        includeSessions: sessions,
        includeSQLConfigs: sqlConfigs,
        includeSettings: settings,
        includeSnippets: snippets,
        includeHostKeys: hostKeys,
        includeClientKeys: clientKeys,
        includeCredentials,
        password: passwordProtect ? password : undefined,
      }

      const result = await window.novadeck.sessions.exportBuild(options)

      if (!result.success || !result.data) {
        toast.error('Export failed', result.error || 'Unknown error')
        setExporting(false)
        return
      }

      // data is the stringified export content
      const content = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)

      const defaultFilename = `shellway-backup-${formatDate()}.shellway`
      const saveResult = await window.novadeck.dialog.saveFile({
        title: 'Save Backup',
        defaultPath: defaultFilename,
        filters: [
          { name: 'Shellway Backup', extensions: ['shellway'] },
          { name: 'JSON', extensions: ['json'] }
        ]
      }) as { canceled: boolean; filePath?: string }

      if (saveResult.canceled || !saveResult.filePath) {
        setExporting(false)
        return
      }

      await window.novadeck.fs.writeFile(saveResult.filePath, content)
      toast.success('Export complete', `Backup saved to ${saveResult.filePath}`)
      onClose()
    } catch (err) {
      toast.error('Export failed', String(err))
    } finally {
      setExporting(false)
    }
  }, [canExport, sessions, sqlConfigs, settings, snippets, hostKeys, clientKeys, includeCredentials, passwordProtect, password, onClose])

  // Section items config
  const exportItems = [
    { key: 'sessions' as const, label: 'Sessions', icon: Monitor, checked: sessions, onChange: setSessions, count: counts?.sessions },
    { key: 'sqlConfigs' as const, label: 'Database connections', icon: Database, checked: sqlConfigs, onChange: setSqlConfigs, count: counts?.sqlConfigs },
    { key: 'settings' as const, label: 'App settings', icon: Settings, checked: settings, onChange: setSettings, count: undefined },
    { key: 'snippets' as const, label: 'Command snippets', icon: Code2, checked: snippets, onChange: setSnippets, count: counts?.snippets },
    { key: 'hostKeys' as const, label: 'Trusted host keys', icon: KeyRound, checked: hostKeys, onChange: setHostKeys, count: counts?.hostKeys },
    { key: 'clientKeys' as const, label: 'Client keys', icon: Key, checked: clientKeys, onChange: setClientKeys, count: counts?.clientKeys }
  ]

  return (
    <Modal open={open} onClose={onClose} title="Export Backup" maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        {/* ── What to export ── */}
        <div>
          <h3 className="text-xs font-semibold text-nd-text-muted uppercase tracking-wider mb-2">
            What to export
          </h3>
          <div className="rounded-lg border border-nd-border divide-y divide-nd-border">
            {exportItems.map((item) => (
              <label
                key={item.key}
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-nd-surface/50 transition-colors first:rounded-t-lg last:rounded-b-lg"
              >
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => item.onChange(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-nd-border text-nd-accent focus:ring-nd-accent bg-nd-surface"
                />
                <item.icon size={14} className="text-nd-text-muted shrink-0" />
                <span className="text-xs text-nd-text-primary flex-1">{item.label}</span>
                {item.count !== undefined && (
                  <span className="text-2xs text-nd-text-muted tabular-nums">{item.count}</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* ── Security options ── */}
        <div>
          <h3 className="text-xs font-semibold text-nd-text-muted uppercase tracking-wider mb-2">
            Security
          </h3>
          <div className="rounded-lg border border-nd-border p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert size={14} className="text-nd-text-muted shrink-0" />
              <Toggle
                checked={includeCredentials}
                onChange={handleCredentialsChange}
                label="Include credentials (passwords, keys)"
              />
            </div>

            {includeCredentials && (
              <div className="rounded-md bg-nd-warning/10 border border-nd-warning/20 px-3 py-2 flex items-start gap-2">
                <AlertTriangle size={14} className="text-nd-warning shrink-0 mt-0.5" />
                <p className="text-2xs text-nd-warning leading-relaxed">
                  Credentials will be included. Protect this file with a password.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Lock size={14} className="text-nd-text-muted shrink-0" />
              <Toggle
                checked={passwordProtect}
                onChange={setPasswordProtect}
                label="Password-protect file"
                disabled={includeCredentials}
              />
            </div>

            {passwordProtect && (
              <div className="flex flex-col gap-2 pl-6">
                <Input
                  type="password"
                  placeholder="Password (min 4 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={passwordError}
                />
                <Input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  error={confirmError}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={exporting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleExport} disabled={!canExport}>
            {exporting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download size={14} />
                Export
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
