import { useMemo, useState } from 'react'
import { ArrowRightLeft, Play, Plus, Square, Trash2 } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import type { PortForwardRule } from '@/types/session'
import { reachableAddress, ruleFromForm, ruleTitle, type RuleForm } from './portForwardRules'
import { RuleFormModal } from './RuleFormModal'
import { RuleRow } from './RuleRow'
import { usePortForwards, type StartFailure } from './usePortForwards'

interface PortForwardingViewProps {
  connectionId: string
  sessionId: string
  connected: boolean
}

function reportFailures(failures: StartFailure[]): void {
  if (failures.length === 0) return
  const [first] = failures
  if (failures.length === 1) {
    toast.error(`Couldn't start "${ruleTitle(first.rule)}"`, first.error)
    return
  }
  toast.error(`${failures.length} rules couldn't start`, `${ruleTitle(first.rule)}: ${first.error}`)
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export function PortForwardingView({ connectionId, sessionId, connected }: PortForwardingViewProps) {
  const { rules, entries, start, stop, saveRule, deleteRules } = usePortForwards(connectionId, sessionId, connected)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PortForwardRule | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PortForwardRule[] | null>(null)

  const selected = useMemo(() => rules.filter((rule) => selectedIds.has(rule.id)), [rules, selectedIds])
  const isRunning = (rule: PortForwardRule) => entries.get(rule.id)?.status === 'active'
  const stopped = rules.filter((rule) => !isRunning(rule))
  const running = rules.filter(isRunning)

  const startRules = async (targets: PortForwardRule[]) => reportFailures(await start(targets.filter((rule) => !isRunning(rule))))
  const stopRules = (targets: PortForwardRule[]) => stop(targets.map((rule) => rule.id))

  const toggleSelected = (id: string, on: boolean) =>
    setSelectedIds((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const openForm = (rule: PortForwardRule | null) => {
    setEditing(rule)
    setFormOpen(true)
  }

  const handleSave = async (form: RuleForm) => {
    const rule = ruleFromForm(form, editing?.id ?? uuid())
    setFormOpen(false)
    reportFailures(await saveRule(rule))
    toast.success(editing ? 'Rule saved' : 'Rule created')
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const ids = pendingDelete.map((rule) => rule.id)
    setPendingDelete(null)
    await deleteRules(ids)
    setSelectedIds((current) => new Set([...current].filter((id) => !ids.includes(id))))
  }

  const copyAddress = async (rule: PortForwardRule) => {
    await navigator.clipboard.writeText(reachableAddress(rule))
    toast.success('Address copied', reachableAddress(rule))
  }

  const allSelected = rules.length > 0 && selected.length === rules.length

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-nd-text-primary">Port Forwarding</h2>
          <p className="mt-0.5 text-xs text-nd-text-muted">Manage SSH tunnels and port forwarding rules</p>
        </div>
        <div className="flex items-center gap-2">
          {rules.length > 0 && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void startRules(stopped)} disabled={!connected || stopped.length === 0}>
                <Play size={13} />
                Start all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void stopRules(running)} disabled={running.length === 0}>
                <Square size={13} />
                Stop all
              </Button>
            </>
          )}
          <Button variant="primary" size="sm" onClick={() => openForm(null)}>
            <Plus size={14} />
            New rule
          </Button>
        </div>
      </div>

      {!connected && rules.length > 0 && (
        <p className="mb-3 text-xs text-nd-text-muted">Connect to this server to start tunnels.</p>
      )}

      {rules.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-nd-surface">
            <ArrowRightLeft size={24} className="text-nd-text-muted" />
          </div>
          <p className="text-sm font-medium text-nd-text-secondary">No forwarding rules</p>
          <p className="mt-1 text-2xs text-nd-text-muted">Create a port forwarding rule to tunnel traffic through SSH</p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex h-7 items-center gap-3 px-3 text-xs text-nd-text-muted">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-nd-accent"
                checked={allSelected}
                onChange={(event) => setSelectedIds(event.target.checked ? new Set(rules.map((rule) => rule.id)) : new Set())}
              />
              {selected.length > 0 ? `${selected.length} selected` : 'Select all'}
            </label>
            {selected.length > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => void startRules(selected)} disabled={!connected}>
                  <Play size={13} />
                  Start
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void stopRules(selected)}>
                  <Square size={13} />
                  Stop
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPendingDelete(selected)}>
                  <Trash2 size={13} />
                  Delete
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                entry={entries.get(rule.id)}
                connected={connected}
                selected={selectedIds.has(rule.id)}
                onSelect={(on) => toggleSelected(rule.id, on)}
                onStart={() => void startRules([rule])}
                onStop={() => void stopRules([rule])}
                onEdit={() => openForm(rule)}
                onDelete={() => setPendingDelete([rule])}
                onCopy={() => void copyAddress(rule)}
                onOpen={() => window.open(`http://${reachableAddress(rule)}`)}
              />
            ))}
          </div>
        </>
      )}

      <RuleFormModal
        open={formOpen}
        rule={editing}
        otherRules={rules.filter((rule) => rule.id !== editing?.id)}
        onClose={() => setFormOpen(false)}
        onSave={(form) => void handleSave(form)}
      />

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={pendingDelete?.length === 1 ? `Delete "${ruleTitle(pendingDelete[0])}"?` : `Delete ${plural(pendingDelete?.length ?? 0, 'rule')}?`}
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-nd-text-secondary">Running tunnels stop right away. This can't be undone.</p>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="ghost" onClick={() => setPendingDelete(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirmDelete()}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  )
}
