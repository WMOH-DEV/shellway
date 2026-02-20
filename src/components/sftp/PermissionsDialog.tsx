import { useState, useEffect, useCallback, useMemo } from 'react'
import { Shield } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import type { FileEntry } from '@/types/sftp'

interface PermissionsDialogProps {
  open: boolean
  onClose: () => void
  entry: FileEntry
  connectionId: string
  onDone: () => void
}

/** Permission bit masks */
const BITS = {
  ownerRead:    0o400,
  ownerWrite:   0o200,
  ownerExec:    0o100,
  groupRead:    0o040,
  groupWrite:   0o020,
  groupExec:    0o010,
  otherRead:    0o004,
  otherWrite:   0o002,
  otherExec:    0o001,
} as const

type BitKey = keyof typeof BITS

const ROWS: { label: string; read: BitKey; write: BitKey; exec: BitKey }[] = [
  { label: 'Owner', read: 'ownerRead', write: 'ownerWrite', exec: 'ownerExec' },
  { label: 'Group', read: 'groupRead', write: 'groupWrite', exec: 'groupExec' },
  { label: 'Other', read: 'otherRead', write: 'otherWrite', exec: 'otherExec' },
]

function modeToString(mode: number): string {
  const chars = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-',
  ]
  return chars.join('')
}

function fileName(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(sep).filter(Boolean)
  return parts[parts.length - 1] || ''
}

export function PermissionsDialog({ open, onClose, entry, connectionId, onDone }: PermissionsDialogProps) {
  const initialMode = entry.permissions ?? 0o644
  const [mode, setMode] = useState(initialMode & 0o777)
  const [octalInput, setOctalInput] = useState((initialMode & 0o777).toString(8).padStart(3, '0'))
  const [recursive, setRecursive] = useState(false)
  const [saving, setSaving] = useState(false)

  // Reset when entry changes
  useEffect(() => {
    const m = (entry.permissions ?? 0o644) & 0o777
    setMode(m)
    setOctalInput(m.toString(8).padStart(3, '0'))
    setRecursive(false)
  }, [entry.path, entry.permissions])

  const toggleBit = useCallback((bit: BitKey) => {
    setMode((prev) => {
      const next = prev ^ BITS[bit]
      setOctalInput(next.toString(8).padStart(3, '0'))
      return next
    })
  }, [])

  const handleOctalChange = useCallback((val: string) => {
    // Allow only octal digits, max 3 chars
    const cleaned = val.replace(/[^0-7]/g, '').slice(0, 3)
    setOctalInput(cleaned)
    if (cleaned.length > 0) {
      setMode(parseInt(cleaned, 8) || 0)
    }
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const result = await window.novadeck.sftp.chmod(connectionId, entry.path, mode, recursive)
      if (result?.success !== false) {
        toast.success('Permissions updated', `${fileName(entry.path)} → ${octalInput} (${modeToString(mode)})`)
        onDone()
        onClose()
      } else {
        toast.error('Failed to set permissions', (result as any)?.error || 'Unknown error')
      }
    } catch (err) {
      toast.error('Failed to set permissions', String(err))
    } finally {
      setSaving(false)
    }
  }, [connectionId, entry.path, mode, recursive, octalInput, onDone, onClose])

  const symbolicStr = useMemo(() => modeToString(mode), [mode])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Properties / Permissions"
      maxWidth="max-w-sm"
    >
      <div className="space-y-4">
        {/* File info */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-nd-surface border border-nd-border">
          <Shield size={16} className="text-nd-accent shrink-0" />
          <div className="min-w-0">
            <p className="text-sm text-nd-text-primary font-medium truncate">{fileName(entry.path)}</p>
            <p className="text-2xs text-nd-text-muted truncate">{entry.path}</p>
          </div>
        </div>

        {/* Permission grid */}
        <div className="rounded-md border border-nd-border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-4 bg-nd-bg-tertiary border-b border-nd-border">
            <div className="px-3 py-1.5 text-2xs font-medium text-nd-text-muted" />
            <div className="px-3 py-1.5 text-2xs font-medium text-nd-text-muted text-center">Read</div>
            <div className="px-3 py-1.5 text-2xs font-medium text-nd-text-muted text-center">Write</div>
            <div className="px-3 py-1.5 text-2xs font-medium text-nd-text-muted text-center">Execute</div>
          </div>

          {/* Rows */}
          {ROWS.map((row, idx) => (
            <div
              key={row.label}
              className={`grid grid-cols-4 items-center ${idx < ROWS.length - 1 ? 'border-b border-nd-border' : ''}`}
            >
              <div className="px-3 py-2 text-xs text-nd-text-secondary font-medium">{row.label}</div>
              {(['read', 'write', 'exec'] as const).map((perm) => {
                const bitKey = row[perm]
                const isSet = (mode & BITS[bitKey]) !== 0
                return (
                  <div key={perm} className="flex justify-center py-2">
                    <button
                      onClick={() => toggleBit(bitKey)}
                      className={`w-5 h-5 rounded border transition-all flex items-center justify-center ${
                        isSet
                          ? 'bg-nd-accent border-nd-accent text-white'
                          : 'bg-nd-surface border-nd-border text-transparent hover:border-nd-accent/50'
                      }`}
                    >
                      {isSet && (
                        <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Octal + symbolic display */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-nd-text-muted">Octal:</label>
            <input
              type="text"
              value={octalInput}
              onChange={(e) => handleOctalChange(e.target.value)}
              className="w-16 h-7 px-2 rounded bg-nd-surface border border-nd-border text-sm text-nd-text-primary font-mono text-center focus:outline-none focus:border-nd-accent transition-colors"
              maxLength={3}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-nd-text-muted">Symbolic:</label>
            <span className="text-sm text-nd-text-primary font-mono">{symbolicStr}</span>
          </div>
        </div>

        {/* Recursive toggle (for directories) */}
        {entry.isDirectory && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-nd-border bg-nd-surface accent-nd-accent"
            />
            <span className="text-xs text-nd-text-secondary">Apply recursively to all contents</span>
          </label>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Apply'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
