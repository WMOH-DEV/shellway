import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Search, Key, Trash2, Download, Upload, ChevronDown,
  ChevronRight, Copy, StickyNote, X, ArrowUpDown,
  Plus, FileKey, Pencil, Clock
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/Toast'
import type { ClientKeyInfo } from '@/types/clientkey'

type SortField = 'name' | 'keyType' | 'fingerprint' | 'createdAt' | 'lastUsed'
type SortDirection = 'asc' | 'desc'

interface ClientKeyManagerProps {
  open: boolean
  onClose: () => void
}

/**
 * Client Key Manager — manage SSH client key pairs.
 * Import private keys, view public keys, assign to sessions.
 * Equivalent of Bitvise's "Client Key Manager".
 */
export function ClientKeyManager({ open, onClose }: ClientKeyManagerProps) {
  const [clientKeys, setClientKeys] = useState<ClientKeyInfo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ClientKeyInfo | null>(null)

  // Import form state
  const [importOpen, setImportOpen] = useState(false)
  const [importName, setImportName] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [importSavePassphrase, setImportSavePassphrase] = useState(false)
  const [importFilePath, setImportFilePath] = useState('')
  const [importMode, setImportMode] = useState<'file' | 'paste'>('file')
  const [importPasteData, setImportPasteData] = useState('')
  const [importing, setImporting] = useState(false)

  // Edit form state
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; comment: string } | null>(null)

  // Load keys
  useEffect(() => {
    if (!open) return
    loadKeys()
  }, [open])

  const loadKeys = async () => {
    try {
      const keys = await window.novadeck.clientkey.getAll()
      if (keys) setClientKeys(keys as ClientKeyInfo[])
    } catch {
      // API may not be available yet
    }
  }

  // Filter
  const filtered = useMemo(() => {
    if (!searchQuery) return clientKeys
    const q = searchQuery.toLowerCase()
    return clientKeys.filter(
      (k) =>
        k.name.toLowerCase().includes(q) ||
        k.keyType.toLowerCase().includes(q) ||
        k.fingerprint.toLowerCase().includes(q) ||
        (k.comment && k.comment.toLowerCase().includes(q))
    )
  }, [clientKeys, searchQuery])

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'keyType': cmp = a.keyType.localeCompare(b.keyType); break
        case 'fingerprint': cmp = a.fingerprint.localeCompare(b.fingerprint); break
        case 'createdAt': cmp = a.createdAt - b.createdAt; break
        case 'lastUsed': cmp = (a.lastUsed ?? 0) - (b.lastUsed ?? 0); break
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
      await window.novadeck.clientkey.remove(deleteTarget.id)
      setClientKeys((prev) => prev.filter((k) => k.id !== deleteTarget.id))
      toast.success('Key removed', `"${deleteTarget.name}" has been deleted`)
    } catch {
      toast.error('Failed to remove key')
    }
    setDeleteTarget(null)
  }, [deleteTarget])

  const handleBrowseFile = async () => {
    const result = await window.novadeck.dialog.openFile({
      title: 'Select Private Key File',
      properties: ['openFile'],
      filters: [
        { name: 'Key Files', extensions: ['pem', 'ppk', 'key', 'pub', 'id_rsa', 'id_ed25519', 'id_ecdsa'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!result.canceled && result.filePaths[0]) {
      setImportFilePath(result.filePaths[0])
      // Auto-generate name from filename
      if (!importName) {
        const fileName = result.filePaths[0].split(/[/\\]/).pop() || ''
        setImportName(fileName.replace(/\.(pem|ppk|key|pub)$/i, ''))
      }
    }
  }

  const handleImport = async () => {
    if (importMode === 'file' && !importFilePath) {
      toast.error('No file selected')
      return
    }
    if (importMode === 'paste' && !importPasteData.trim()) {
      toast.error('No key data provided')
      return
    }

    setImporting(true)
    try {
      let result: { success: boolean; data?: unknown; error?: string }

      if (importMode === 'file') {
        result = await window.novadeck.clientkey.importFile(
          importFilePath,
          importName || 'Imported Key',
          importPassphrase || undefined,
          importSavePassphrase
        )
      } else {
        result = await window.novadeck.clientkey.importData(
          importPasteData,
          importName || 'Pasted Key',
          importPassphrase || undefined,
          importSavePassphrase
        )
      }

      if (result.success && result.data) {
        setClientKeys((prev) => [...prev, result.data as ClientKeyInfo])
        toast.success('Key imported', `"${importName || 'Key'}" has been added`)
        resetImportForm()
        setImportOpen(false)
      } else {
        toast.error('Import failed', result.error || 'Unknown error')
      }
    } catch (err) {
      toast.error('Import failed', String(err))
    } finally {
      setImporting(false)
    }
  }

  const resetImportForm = () => {
    setImportName('')
    setImportPassphrase('')
    setImportSavePassphrase(false)
    setImportFilePath('')
    setImportPasteData('')
    setImportMode('file')
  }

  const handleSaveEdit = useCallback(async () => {
    if (!editTarget) return
    try {
      await window.novadeck.clientkey.update(editTarget.id, {
        name: editTarget.name,
        comment: editTarget.comment
      })
      setClientKeys((prev) =>
        prev.map((k) =>
          k.id === editTarget.id ? { ...k, name: editTarget.name, comment: editTarget.comment } : k
        )
      )
      toast.success('Key updated')
    } catch {
      toast.error('Failed to update key')
    }
    setEditTarget(null)
  }, [editTarget])

  const handleCopyPublicKey = useCallback(async (key: ClientKeyInfo) => {
    try {
      const pubKey = await window.novadeck.clientkey.getPublicKey(key.id)
      if (pubKey) {
        navigator.clipboard.writeText(pubKey)
        toast.success('Public key copied', 'Paste it into your server\'s authorized_keys')
      }
    } catch {
      toast.error('Failed to get public key')
    }
  }, [])

  const formatDate = (ts?: number) => {
    if (!ts) return '—'
    const d = new Date(ts)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const SortHeader = ({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <button
      onClick={() => handleSort(field)}
      className={cn(
        'flex items-center gap-1 text-2xs font-medium uppercase tracking-wider transition-colors',
        sortField === field ? 'text-nd-accent' : 'text-nd-text-muted hover:text-nd-text-secondary',
        className
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
        title="Client Key Manager"
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
                placeholder="Search keys..."
                className="w-full h-7 pl-8 pr-3 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => { resetImportForm(); setImportOpen(true) }}
            >
              <Plus size={12} />
              Import Key
            </Button>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[2fr_80px_minmax(120px,2fr)_110px_110px] gap-2 px-3 py-1.5">
            <SortHeader field="name">Name</SortHeader>
            <SortHeader field="keyType">Type</SortHeader>
            <SortHeader field="fingerprint">Fingerprint</SortHeader>
            <SortHeader field="createdAt">Imported</SortHeader>
            <SortHeader field="lastUsed">Last Used</SortHeader>
          </div>

          {/* Key list */}
          <div className="flex-1 overflow-y-auto min-h-[200px]">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Key size={24} className="text-nd-text-muted mb-3" />
                <p className="text-sm text-nd-text-secondary">
                  {searchQuery ? 'No matching keys' : 'No client keys yet'}
                </p>
                <p className="text-2xs text-nd-text-muted mt-1">
                  {searchQuery
                    ? 'Try a different search term'
                    : 'Import your SSH private keys to use them for authentication'}
                </p>
                {!searchQuery && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => { resetImportForm(); setImportOpen(true) }}
                  >
                    <Plus size={12} />
                    Import Your First Key
                  </Button>
                )}
              </div>
            ) : (
              sorted.map((key) => {
                const isExpanded = expandedId === key.id
                return (
                  <div key={key.id} className="border-b border-nd-border last:border-b-0">
                    {/* Row */}
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : key.id)}
                      className="grid grid-cols-[2fr_80px_minmax(120px,2fr)_110px_110px] gap-2 px-3 py-2 cursor-pointer hover:bg-nd-surface/60 transition-colors items-center"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {isExpanded
                          ? <ChevronDown size={11} className="text-nd-text-muted shrink-0" />
                          : <ChevronRight size={11} className="text-nd-text-muted shrink-0" />
                        }
                        <FileKey size={13} className="text-nd-accent shrink-0" />
                        <span className="text-xs text-nd-text-primary truncate">{key.name}</span>
                        {key.hasPassphrase && (
                          <Key size={9} className="text-nd-warning shrink-0 ml-0.5" />
                        )}
                      </div>
                      <span className="text-2xs text-nd-text-secondary uppercase">
                        {key.keyType} {key.keySize > 0 ? key.keySize : ''}
                      </span>
                      <Tooltip content={key.fingerprint}>
                        <span className="text-2xs text-nd-text-muted font-mono truncate block cursor-help overflow-hidden">
                          {key.fingerprint.substring(0, 24)}...
                        </span>
                      </Tooltip>
                      <span className="text-2xs text-nd-text-muted truncate">{formatDate(key.createdAt)}</span>
                      <span className="text-2xs text-nd-text-muted truncate">{formatDate(key.lastUsed)}</span>
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
                              <label className="text-2xs font-medium text-nd-text-secondary">Fingerprint</label>
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
                              <div className="flex items-center gap-2 mt-0.5">
                                <code className="block text-2xs font-mono text-nd-text-muted bg-nd-bg-primary px-2 py-1 rounded border border-nd-border flex-1 break-all max-h-20 overflow-y-auto">
                                  {key.publicKey}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => handleCopyPublicKey(key)}
                                  title="Copy public key (for authorized_keys)"
                                >
                                  <Copy size={11} />
                                </Button>
                              </div>
                              <p className="text-2xs text-nd-text-muted mt-1">
                                Copy and paste into the server's <code className="font-mono">~/.ssh/authorized_keys</code>
                              </p>
                            </div>
                            {key.comment && (
                              <div>
                                <label className="text-2xs font-medium text-nd-text-secondary">Note</label>
                                <p className="text-xs text-nd-text-muted mt-0.5">{key.comment}</p>
                              </div>
                            )}
                            <div className="flex items-center gap-2 pt-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditTarget({ id: key.id, name: key.name, comment: key.comment || '' })
                                }}
                              >
                                <Pencil size={11} />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleCopyPublicKey(key)
                                }}
                              >
                                <Copy size={11} />
                                Copy Public Key
                              </Button>
                              <div className="flex-1" />
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteTarget(key)
                                }}
                              >
                                <Trash2 size={11} />
                                Delete
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
            {sorted.length} client key{sorted.length !== 1 ? 's' : ''}
          </div>
        </div>
      </Modal>

      {/* Import Key Modal */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Client Key"
        maxWidth="max-w-md"
      >
        <div className="flex flex-col gap-3">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setImportMode('file')}
              className={cn(
                'flex-1 py-1.5 rounded text-xs font-medium transition-colors',
                importMode === 'file'
                  ? 'bg-nd-accent text-white'
                  : 'bg-nd-surface text-nd-text-muted hover:text-nd-text-primary'
              )}
            >
              From File
            </button>
            <button
              onClick={() => setImportMode('paste')}
              className={cn(
                'flex-1 py-1.5 rounded text-xs font-medium transition-colors',
                importMode === 'paste'
                  ? 'bg-nd-accent text-white'
                  : 'bg-nd-surface text-nd-text-muted hover:text-nd-text-primary'
              )}
            >
              Paste Key Data
            </button>
          </div>

          <Input
            label="Key Name"
            placeholder="My VPS Key"
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
          />

          {importMode === 'file' ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-nd-text-secondary">Private Key File</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={importFilePath}
                  readOnly
                  placeholder="No file selected"
                  className="flex-1 h-7 px-3 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted"
                />
                <Button variant="secondary" size="sm" onClick={handleBrowseFile}>
                  Browse
                </Button>
              </div>
              <p className="text-2xs text-nd-text-muted">
                Supports OpenSSH, PEM, and PPK formats (id_rsa, id_ed25519, etc.)
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-nd-text-secondary">Private Key Data</label>
              <textarea
                value={importPasteData}
                onChange={(e) => setImportPasteData(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                rows={6}
                className="w-full px-3 py-2 rounded bg-nd-surface border border-nd-border text-xs font-mono text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent resize-y"
              />
            </div>
          )}

          <Input
            label="Passphrase (if key is encrypted)"
            type="password"
            placeholder="Leave empty if none"
            value={importPassphrase}
            onChange={(e) => setImportPassphrase(e.target.value)}
          />

          {importPassphrase && (
            <Toggle
              checked={importSavePassphrase}
              onChange={setImportSavePassphrase}
              label="Save passphrase (encrypted)"
            />
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleImport}
              disabled={importing || (importMode === 'file' ? !importFilePath : !importPasteData.trim())}
            >
              {importing ? 'Importing...' : 'Import Key'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Client Key"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-nd-text-secondary mb-4">
          Delete key <strong className="text-nd-text-primary">"{deleteTarget?.name}"</strong>?
          This cannot be undone. Sessions using this key will need to be reconfigured.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
        </div>
      </Modal>

      {/* Edit name/comment modal */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Edit Key"
        maxWidth="max-w-sm"
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Name"
            value={editTarget?.name || ''}
            onChange={(e) => setEditTarget((prev) => prev ? { ...prev, name: e.target.value } : null)}
          />
          <Input
            label="Note"
            placeholder="Add a note..."
            value={editTarget?.comment || ''}
            onChange={(e) => setEditTarget((prev) => prev ? { ...prev, comment: e.target.value } : null)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveEdit}>Save</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
