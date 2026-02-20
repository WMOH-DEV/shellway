import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { toast } from '@/components/ui/Toast'
import { permissionsToString, permissionsToOctal, getPermBits, setPermBits } from '@/utils/permissions'
import type { FileEntry } from '@/types/sftp'

interface PermissionsEditorProps {
  open: boolean
  onClose: () => void
  entry: FileEntry | null
  connectionId: string
}

const ROLES: Array<'owner' | 'group' | 'other'> = ['owner', 'group', 'other']
const PERMS: Array<'r' | 'w' | 'x'> = ['r', 'w', 'x']
const PERM_LABELS = { r: 'Read', w: 'Write', x: 'Execute' }

/**
 * Visual chmod editor dialog.
 * Checkboxes for each permission bit with bidirectional octal sync.
 */
export function PermissionsEditor({ open, onClose, entry, connectionId }: PermissionsEditorProps) {
  const [mode, setMode] = useState(0o644)
  const [octalInput, setOctalInput] = useState('644')
  const [recursive, setRecursive] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (entry) {
      setMode(entry.permissions)
      setOctalInput(permissionsToOctal(entry.permissions))
      setRecursive(false)
    }
  }, [entry])

  const updateMode = useCallback((newMode: number) => {
    setMode(newMode)
    setOctalInput(permissionsToOctal(newMode))
  }, [])

  const handleOctalChange = useCallback((value: string) => {
    setOctalInput(value)
    const parsed = parseInt(value, 8)
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 0o777) {
      setMode(parsed)
    }
  }, [])

  const handleBitToggle = useCallback(
    (role: 'owner' | 'group' | 'other', bit: 'r' | 'w' | 'x') => {
      const bits = getPermBits(mode, role)
      bits[bit] = !bits[bit]
      updateMode(setPermBits(mode, role, bits))
    },
    [mode, updateMode]
  )

  const handleSave = useCallback(async () => {
    if (!entry) return
    setSaving(true)
    try {
      await window.novadeck.sftp.chmod(connectionId, entry.path, mode, recursive)
      toast.success('Permissions updated', `${entry.name} → ${permissionsToOctal(mode)}`)
      onClose()
    } catch (err) {
      toast.error('Failed to change permissions', String(err))
    } finally {
      setSaving(false)
    }
  }, [entry, connectionId, mode, recursive, onClose])

  if (!entry) return null

  return (
    <Modal open={open} onClose={onClose} title="Permissions" maxWidth="max-w-md">
      <div className="flex flex-col gap-4">
        {/* File info */}
        <div className="flex items-center gap-2 p-3 rounded bg-nd-surface border border-nd-border">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-nd-text-primary truncate">{entry.name}</p>
            <p className="text-2xs text-nd-text-muted truncate">{entry.path}</p>
          </div>
        </div>

        {/* Permission grid */}
        <div className="overflow-hidden rounded border border-nd-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-nd-bg-tertiary">
                <th className="text-left px-3 py-2 text-nd-text-muted font-medium">Role</th>
                {PERMS.map((p) => (
                  <th key={p} className="text-center px-3 py-2 text-nd-text-muted font-medium">
                    {PERM_LABELS[p]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role) => {
                const bits = getPermBits(mode, role)
                return (
                  <tr key={role} className="border-t border-nd-border">
                    <td className="px-3 py-2 capitalize text-nd-text-primary font-medium">
                      {role}
                    </td>
                    {PERMS.map((p) => (
                      <td key={p} className="text-center px-3 py-2">
                        <input
                          type="checkbox"
                          checked={bits[p]}
                          onChange={() => handleBitToggle(role, p)}
                          className="rounded border-nd-border text-nd-accent focus:ring-nd-accent"
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Octal input + preview */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-nd-text-secondary">Octal:</label>
            <input
              type="text"
              value={octalInput}
              onChange={(e) => handleOctalChange(e.target.value)}
              maxLength={4}
              className="w-16 h-7 px-2 rounded bg-nd-surface border border-nd-border text-sm text-nd-text-primary font-mono text-center focus:outline-none focus:border-nd-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-nd-text-secondary">Preview:</label>
            <code className="text-sm font-mono text-nd-accent">{permissionsToString(mode)}</code>
          </div>
        </div>

        {/* Recursive option for directories */}
        {entry.isDirectory && (
          <Toggle
            checked={recursive}
            onChange={setRecursive}
            label="Apply recursively to contents"
          />
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Apply'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
