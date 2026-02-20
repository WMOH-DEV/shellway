import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Search, Shield, Trash2, Download, Upload, ChevronDown,
  ChevronRight, Copy, StickyNote, X, ArrowUpDown
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Tooltip } from '@/components/ui/Tooltip'
import { Dropdown } from '@/components/ui/Dropdown'
import { toast } from '@/components/ui/Toast'

interface TrustedHostKey {
  id: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  publicKeyBase64: string
  trustedAt: number
  lastSeen: number
  comment?: string
}

type SortField = 'host' | 'keyType' | 'fingerprint' | 'trustedAt' | 'lastSeen'
type SortDirection = 'asc' | 'desc'

interface HostKeyManagerProps {
  open: boolean
  onClose: () => void
}

/**
 * Host Key Manager — manage trusted SSH host keys.
 * Accessible via sidebar gear menu (modal overlay).
 */
export function HostKeyManager({ open, onClose }: HostKeyManagerProps) {
  const [hostKeys, setHostKeys] = useState<TrustedHostKey[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('host')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TrustedHostKey | null>(null)
  const [editingComment, setEditingComment] = useState<{ id: string; value: string } | null>(null)

  // Load host keys
  useEffect(() => {
    if (!open) return
    const loadKeys = async () => {
      try {
        const keys = await window.novadeck.hostkey?.getAll?.()
        if (keys) setHostKeys(keys as TrustedHostKey[])
      } catch {
        // Host key API may not be available yet
      }
    }
    loadKeys()
  }, [open])

  // Filter
  const filtered = useMemo(() => {
    if (!searchQuery) return hostKeys
    const q = searchQuery.toLowerCase()
    return hostKeys.filter(
      (k) =>
        k.host.toLowerCase().includes(q) ||
        k.keyType.toLowerCase().includes(q) ||
        k.fingerprint.toLowerCase().includes(q) ||
        (k.comment && k.comment.toLowerCase().includes(q))
    )
  }, [hostKeys, searchQuery])

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'host': cmp = `${a.host}:${a.port}`.localeCompare(`${b.host}:${b.port}`); break
        case 'keyType': cmp = a.keyType.localeCompare(b.keyType); break
        case 'fingerprint': cmp = a.fingerprint.localeCompare(b.fingerprint); break
        case 'trustedAt': cmp = a.trustedAt - b.trustedAt; break
        case 'lastSeen': cmp = a.lastSeen - b.lastSeen; break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortField, sortDir])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await window.novadeck.hostkey?.remove?.(deleteTarget.id)
      setHostKeys((prev) => prev.filter((k) => k.id !== deleteTarget.id))
      toast.success('Host key removed')
    } catch {
      toast.error('Failed to remove host key')
    }
    setDeleteTarget(null)
  }, [deleteTarget])

  const handleDeleteAllForHost = useCallback(async (host: string, port: number) => {
    try {
      await window.novadeck.hostkey?.removeAllForHost?.(host, port)
      setHostKeys((prev) => prev.filter((k) => !(k.host === host && k.port === port)))
      toast.success(`Removed all keys for ${host}:${port}`)
    } catch {
      toast.error('Failed to remove host keys')
    }
  }, [])

  const handleSaveComment = useCallback(async () => {
    if (!editingComment) return
    try {
      await window.novadeck.hostkey?.updateComment?.(editingComment.id, editingComment.value)
      setHostKeys((prev) =>
        prev.map((k) => (k.id === editingComment.id ? { ...k, comment: editingComment.value } : k))
      )
      toast.success('Comment saved')
    } catch {
      toast.error('Failed to save comment')
    }
    setEditingComment(null)
  }, [editingComment])

  const handleExport = async () => {
    try {
      await window.novadeck.hostkey?.export?.()
      toast.success('Host keys exported as known_hosts')
    } catch {
      toast.error('Export failed')
    }
  }

  const handleImport = async () => {
    try {
      const result = await window.novadeck.dialog.openFile({
        title: 'Import known_hosts',
        filters: [{ name: 'All Files', extensions: ['*'] }],
        properties: ['openFile']
      })
      if (result.canceled || !result.filePaths[0]) return
      const content = await window.novadeck.fs.readFile(result.filePaths[0])
      const count = await window.novadeck.hostkey?.import?.(content)
      if (count && count > 0) {
        toast.success(`Imported ${count} host keys`)
        // Reload
        const keys = await window.novadeck.hostkey?.getAll?.()
        if (keys) setHostKeys(keys as TrustedHostKey[])
      } else {
        toast.info('No new host keys imported')
      }
    } catch {
      toast.error('Import failed')
    }
  }

  const formatDate = (ts: number) => {
    if (!ts) return '—'
    const d = new Date(ts)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button
      onClick={() => handleSort(field)}
      className={cn(
        'flex items-center gap-1 text-2xs font-medium uppercase tracking-wider transition-colors',
        sortField === field ? 'text-nd-accent' : 'text-nd-text-muted hover:text-nd-text-secondary'
      )}
    >
      {children}
      {sortField === field && (
        <ArrowUpDown size={10} className={sortDir === 'desc' ? 'rotate-180' : ''} />
      )}
    </button>
  )

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Host Key Manager"
        maxWidth="max-w-4xl"
      >
        <div className="flex flex-col gap-3" style={{ maxHeight: '70vh' }}>
          {/* Toolbar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search host keys..."
                className="w-full h-7 pl-8 pr-3 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={handleImport}>
              <Upload size={12} />
              Import
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download size={12} />
              Export
            </Button>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[minmax(120px,1.5fr)_80px_minmax(100px,2fr)_110px_110px_80px] gap-2 px-3 py-1.5">
            <SortHeader field="host">Host:Port</SortHeader>
            <SortHeader field="keyType">Key Type</SortHeader>
            <SortHeader field="fingerprint">Fingerprint</SortHeader>
            <SortHeader field="trustedAt">Trusted</SortHeader>
            <SortHeader field="lastSeen">Last Seen</SortHeader>
            <span className="text-2xs font-medium uppercase tracking-wider text-nd-text-muted">Comment</span>
          </div>

          {/* Key list */}
          <div className="flex-1 overflow-y-auto min-h-[200px]">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Shield size={24} className="text-nd-text-muted mb-3" />
                <p className="text-sm text-nd-text-secondary">
                  {searchQuery ? 'No matching host keys' : 'No trusted host keys'}
                </p>
                <p className="text-2xs text-nd-text-muted mt-1">
                  Host keys are saved when you connect to servers
                </p>
              </div>
            ) : (
              sorted.map((key) => {
                const isExpanded = expandedId === key.id
                return (
                  <div key={key.id} className="border-b border-nd-border last:border-b-0">
                    {/* Row */}
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : key.id)}
                      className="grid grid-cols-[minmax(120px,1.5fr)_80px_minmax(100px,2fr)_110px_110px_80px] gap-2 px-3 py-2 cursor-pointer hover:bg-nd-surface/60 transition-colors items-center"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {isExpanded ? <ChevronDown size={11} className="text-nd-text-muted shrink-0" /> : <ChevronRight size={11} className="text-nd-text-muted shrink-0" />}
                        <span className="text-xs text-nd-text-primary font-mono truncate">
                          {key.host}:{key.port}
                        </span>
                      </div>
                      <span className="text-2xs text-nd-text-secondary truncate">{key.keyType}</span>
                      <Tooltip content={key.fingerprint}>
                        <span className="text-2xs text-nd-text-muted font-mono truncate block cursor-help overflow-hidden">
                          {key.fingerprint.substring(0, 20)}...
                        </span>
                      </Tooltip>
                      <span className="text-2xs text-nd-text-muted truncate">{formatDate(key.trustedAt)}</span>
                      <span className="text-2xs text-nd-text-muted truncate">{formatDate(key.lastSeen)}</span>
                      <span className="text-2xs text-nd-text-muted truncate">{key.comment || '—'}</span>
                    </div>

                    {/* Expanded detail */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="px-8 py-3 bg-nd-surface/40 flex flex-col gap-2">
                            <div>
                              <label className="text-2xs font-medium text-nd-text-secondary">Full Fingerprint</label>
                              <div className="flex items-center gap-2 mt-0.5">
                                <code className="text-xs font-mono text-nd-text-primary bg-nd-bg-primary px-2 py-1 rounded border border-nd-border flex-1 break-all">
                                  {key.fingerprint}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => {
                                    navigator.clipboard.writeText(key.fingerprint)
                                    toast.success('Fingerprint copied')
                                  }}
                                >
                                  <Copy size={11} />
                                </Button>
                              </div>
                            </div>
                            <div>
                              <label className="text-2xs font-medium text-nd-text-secondary">Public Key</label>
                              <code className="block text-2xs font-mono text-nd-text-muted bg-nd-bg-primary px-2 py-1 rounded border border-nd-border mt-0.5 break-all max-h-20 overflow-y-auto">
                                {key.publicKeyBase64}
                              </code>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteTarget(key)
                                }}
                              >
                                <Trash2 size={11} />
                                Remove Trust
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteAllForHost(key.host, key.port)
                                }}
                              >
                                <Trash2 size={11} />
                                Remove All for Host
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingComment({ id: key.id, value: key.comment || '' })
                                }}
                              >
                                <StickyNote size={11} />
                                {key.comment ? 'Edit Note' : 'Add Note'}
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })
            )}
          </div>

          <div className="text-2xs text-nd-text-muted text-right pt-1">
            {sorted.length} host key{sorted.length !== 1 ? 's' : ''}
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Remove Host Key"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-nd-text-secondary mb-4">
          Remove trust for <strong className="text-nd-text-primary font-mono">{deleteTarget?.host}:{deleteTarget?.port}</strong>?
          The next connection will prompt to re-verify.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete}>Remove</Button>
        </div>
      </Modal>

      {/* Edit comment modal */}
      <Modal
        open={!!editingComment}
        onClose={() => setEditingComment(null)}
        title="Host Key Comment"
        maxWidth="max-w-sm"
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Comment"
            placeholder="Add a note..."
            value={editingComment?.value || ''}
            onChange={(e) => setEditingComment((prev) => prev ? { ...prev, value: e.target.value } : null)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditingComment(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveComment}>Save</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
