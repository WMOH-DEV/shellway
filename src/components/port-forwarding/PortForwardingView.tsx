import { useState, useCallback } from 'react'
import { Plus, Play, Square, Trash2, ExternalLink, Globe, ArrowRightLeft, Shield } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Toggle } from '@/components/ui/Toggle'
import { toast } from '@/components/ui/Toast'
import type { PortForwardRule } from '@/types/session'
import { v4 as uuid } from 'uuid'

interface PortForwardingViewProps {
  connectionId: string
}

/**
 * Port Forwarding management — local, remote, and dynamic forwarding.
 */
export function PortForwardingView({ connectionId }: PortForwardingViewProps) {
  const [rules, setRules] = useState<PortForwardRule[]>([])
  const [activeRules, setActiveRules] = useState<Set<string>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState<PortForwardRule | null>(null)

  // Form state
  const [formType, setFormType] = useState<'local' | 'remote' | 'dynamic'>('local')
  const [formName, setFormName] = useState('')
  const [formSourceHost, setFormSourceHost] = useState('127.0.0.1')
  const [formSourcePort, setFormSourcePort] = useState('')
  const [formDestHost, setFormDestHost] = useState('')
  const [formDestPort, setFormDestPort] = useState('')
  const [formAutoStart, setFormAutoStart] = useState(false)

  const resetForm = () => {
    setFormType('local')
    setFormName('')
    setFormSourceHost('127.0.0.1')
    setFormSourcePort('')
    setFormDestHost('')
    setFormDestPort('')
    setFormAutoStart(false)
    setEditingRule(null)
  }

  const handleSave = useCallback(() => {
    const rule: PortForwardRule = {
      id: editingRule?.id || uuid(),
      type: formType,
      name: formName || undefined,
      sourceHost: formSourceHost,
      sourcePort: parseInt(formSourcePort) || 0,
      destinationHost: formType !== 'dynamic' ? formDestHost : undefined,
      destinationPort: formType !== 'dynamic' ? parseInt(formDestPort) || 0 : undefined,
      autoStart: formAutoStart,
      enabled: true
    }

    if (editingRule) {
      setRules((prev) => prev.map((r) => (r.id === editingRule.id ? rule : r)))
    } else {
      setRules((prev) => [...prev, rule])
    }

    resetForm()
    setShowForm(false)
    toast.success(editingRule ? 'Rule updated' : 'Rule created')
  }, [editingRule, formType, formName, formSourceHost, formSourcePort, formDestHost, formDestPort, formAutoStart])

  const toggleRule = useCallback((id: string) => {
    setActiveRules((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        toast.info('Forwarding stopped')
      } else {
        next.add(id)
        toast.success('Forwarding started')
      }
      return next
    })
  }, [])

  const deleteRule = useCallback((id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id))
    setActiveRules((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const typeIcons = {
    local: <ArrowRightLeft size={14} className="text-nd-accent" />,
    remote: <ArrowRightLeft size={14} className="text-nd-success rotate-180" />,
    dynamic: <Globe size={14} className="text-nd-warning" />
  }

  const typeLabels = {
    local: 'Local',
    remote: 'Remote',
    dynamic: 'Dynamic (SOCKS)'
  }

  return (
    <div className="flex flex-col h-full p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-nd-text-primary">Port Forwarding</h2>
          <p className="text-xs text-nd-text-muted mt-0.5">
            Manage SSH tunnels and port forwarding rules
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => { resetForm(); setShowForm(true) }}>
          <Plus size={14} />
          New Rule
        </Button>
      </div>

      {/* Rule list */}
      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <div className="w-14 h-14 rounded-2xl bg-nd-surface flex items-center justify-center mb-4">
            <ArrowRightLeft size={24} className="text-nd-text-muted" />
          </div>
          <p className="text-sm font-medium text-nd-text-secondary">No forwarding rules</p>
          <p className="text-2xs text-nd-text-muted mt-1">
            Create a port forwarding rule to tunnel traffic through SSH
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => {
            const isActive = activeRules.has(rule.id)
            return (
              <div
                key={rule.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-nd-border bg-nd-bg-secondary"
              >
                {/* Status indicator */}
                <span
                  className={cn(
                    'w-2.5 h-2.5 rounded-full shrink-0',
                    isActive ? 'bg-nd-success' : 'bg-nd-text-muted'
                  )}
                />

                {/* Type icon */}
                {typeIcons[rule.type]}

                {/* Rule info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-nd-text-primary">
                      {rule.name || `${typeLabels[rule.type]} Forward`}
                    </span>
                    <Badge variant={isActive ? 'success' : 'default'}>
                      {isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="text-2xs text-nd-text-muted font-mono mt-0.5">
                    {rule.type === 'dynamic'
                      ? `${rule.sourceHost}:${rule.sourcePort} → SOCKS Proxy`
                      : `${rule.sourceHost}:${rule.sourcePort} → ${rule.destinationHost}:${rule.destinationPort}`}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {rule.type === 'local' && isActive && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        // Open in browser
                      }}
                      title="Open in browser"
                    >
                      <ExternalLink size={13} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toggleRule(rule.id)}
                  >
                    {isActive ? <Square size={13} /> : <Play size={13} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => deleteRule(rule.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Rule Form Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingRule ? 'Edit Rule' : 'New Forwarding Rule'}
        maxWidth="max-w-md"
      >
        <div className="flex flex-col gap-3">
          <Select
            label="Type"
            value={formType}
            onChange={(e) => setFormType(e.target.value as any)}
            options={[
              { value: 'local', label: 'Local Forwarding (L)' },
              { value: 'remote', label: 'Remote Forwarding (R)' },
              { value: 'dynamic', label: 'Dynamic / SOCKS Proxy (D)' }
            ]}
          />
          <Input
            label="Name (optional)"
            placeholder="e.g., Database tunnel"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Source Host"
              value={formSourceHost}
              onChange={(e) => setFormSourceHost(e.target.value)}
            />
            <Input
              label="Source Port"
              type="number"
              placeholder="8080"
              value={formSourcePort}
              onChange={(e) => setFormSourcePort(e.target.value)}
            />
          </div>
          {formType !== 'dynamic' && (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Destination Host"
                placeholder="localhost"
                value={formDestHost}
                onChange={(e) => setFormDestHost(e.target.value)}
              />
              <Input
                label="Destination Port"
                type="number"
                placeholder="3306"
                value={formDestPort}
                onChange={(e) => setFormDestPort(e.target.value)}
              />
            </div>
          )}
          <Toggle
            checked={formAutoStart}
            onChange={setFormAutoStart}
            label="Auto-start on connect"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!formSourcePort}>
              {editingRule ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
