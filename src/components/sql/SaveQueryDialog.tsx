import { useCallback, useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import type { QueryGroup } from '@/types/sql'

interface SaveQueryDialogProps {
  open: boolean
  scopeId: string
  sql: string
  onClose: () => void
  onSaved: () => void
}

const NEW_GROUP = '__new__'
const UNGROUPED = '__none__'

export function SaveQueryDialog({
  open,
  scopeId,
  sql,
  onClose,
  onSaved
}: SaveQueryDialogProps) {
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState(UNGROUPED)
  const [newGroupName, setNewGroupName] = useState('')
  const [groups, setGroups] = useState<QueryGroup[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setGroupId(UNGROUPED)
    setNewGroupName('')
    setError(null)
    window.novadeck.sql
      .queryGroupsList(scopeId)
      .then((result: QueryGroup[]) => setGroups(result ?? []))
      .catch(() => setGroups([]))
  }, [open, scopeId])

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Give the query a name')
      return
    }

    setSaving(true)
    try {
      let resolvedGroupId: string | null = null
      if (groupId === NEW_GROUP) {
        const groupName = newGroupName.trim()
        if (!groupName) {
          setError('Name the new group')
          setSaving(false)
          return
        }
        const created = await window.novadeck.sql.queryGroupCreate(
          scopeId,
          groupName
        )
        resolvedGroupId = created?.id ?? null
      } else if (groupId !== UNGROUPED) {
        resolvedGroupId = groupId
      }

      await window.novadeck.sql.queriesSave(scopeId, {
        name: trimmedName,
        sql,
        groupId: resolvedGroupId
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [name, groupId, newGroupName, scopeId, sql, onSaved, onClose])

  const options = [
    { value: UNGROUPED, label: 'Ungrouped' },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
    { value: NEW_GROUP, label: 'New group…' }
  ]

  return (
    <Modal open={open} onClose={onClose} title="Save query" maxWidth="max-w-md">
      <div className="space-y-4">
        <Input
          autoFocus
          label="Query name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
          }}
          error={error ?? undefined}
          placeholder="Active device tokens"
        />

        <Select
          label="Group"
          options={options}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        />

        {groupId === NEW_GROUP && (
          <Input
            label="New group name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Reports"
          />
        )}

        <pre className="max-h-32 overflow-auto rounded-md bg-nd-surface border border-nd-border p-2.5 text-[11px] font-mono text-nd-text-secondary whitespace-pre-wrap break-all">
          {sql.trim()}
        </pre>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default SaveQueryDialog
