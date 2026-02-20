import { useState } from 'react'
import { Plus, Download, Upload, Key, Trash2, Copy, Shield, ExternalLink } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/components/ui/Toast'

interface SSHKey {
  id: string
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  bits: number
  fingerprint: string
  publicKey: string
  privatePath: string
  createdAt: number
}

/**
 * SSH Key Manager panel.
 * Generate, import, export, and manage SSH keys.
 */
export function KeyManager() {
  const [keys, setKeys] = useState<SSHKey[]>([])
  const [showGenerator, setShowGenerator] = useState(false)
  const [selectedKey, setSelectedKey] = useState<SSHKey | null>(null)

  // Generator state
  const [keyType, setKeyType] = useState<'rsa' | 'ed25519' | 'ecdsa'>('ed25519')
  const [keyBits, setKeyBits] = useState(4096)
  const [keyName, setKeyName] = useState('')
  const [passphrase, setPassphrase] = useState('')

  const handleGenerate = async () => {
    // TODO: Wire to main process key generation
    toast.info('Key generation', 'Key generation will be implemented with the KeyManager service')
    setShowGenerator(false)
  }

  const handleImport = async () => {
    const result = await window.novadeck.dialog.openFile({
      title: 'Import SSH Key',
      filters: [
        { name: 'Key Files', extensions: ['pem', 'ppk', 'key', 'pub', ''] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (!result.canceled && result.filePaths[0]) {
      toast.info('Key imported', `Imported: ${result.filePaths[0]}`)
    }
  }

  return (
    <div className="flex flex-col h-full p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-nd-text-primary">SSH Keys</h2>
          <p className="text-xs text-nd-text-muted mt-0.5">
            Manage your SSH keypairs for authentication
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleImport}>
            <Download size={14} />
            Import
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowGenerator(true)}>
            <Plus size={14} />
            Generate
          </Button>
        </div>
      </div>

      {/* Key list */}
      {keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <div className="w-14 h-14 rounded-2xl bg-nd-surface flex items-center justify-center mb-4">
            <Key size={24} className="text-nd-text-muted" />
          </div>
          <p className="text-sm font-medium text-nd-text-secondary">No SSH keys yet</p>
          <p className="text-2xs text-nd-text-muted mt-1 max-w-xs">
            Generate a new keypair or import an existing one to use for authentication
          </p>
          <Button variant="primary" size="sm" className="mt-4" onClick={() => setShowGenerator(true)}>
            <Plus size={14} />
            Generate Your First Key
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {keys.map((key) => (
            <div
              key={key.id}
              onClick={() => setSelectedKey(key)}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                selectedKey?.id === key.id
                  ? 'bg-nd-surface border-nd-accent/50'
                  : 'border-nd-border hover:bg-nd-surface/60'
              )}
            >
              <div className="w-9 h-9 rounded-lg bg-nd-bg-tertiary flex items-center justify-center">
                <Shield size={16} className="text-nd-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-nd-text-primary">{key.name}</p>
                <p className="text-2xs text-nd-text-muted font-mono truncate">{key.fingerprint}</p>
              </div>
              <Badge variant="accent">
                {key.type.toUpperCase()} {key.bits}
              </Badge>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(key.publicKey)
                    toast.success('Copied', 'Public key copied to clipboard')
                  }}
                >
                  <Copy size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation()
                    setKeys(keys.filter((k) => k.id !== key.id))
                    toast.info('Key deleted')
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Key Generator Modal */}
      <Modal
        open={showGenerator}
        onClose={() => setShowGenerator(false)}
        title="Generate SSH Key"
        maxWidth="max-w-md"
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Key Name"
            placeholder="my-server-key"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
          />
          <Select
            label="Key Type"
            value={keyType}
            onChange={(e) => setKeyType(e.target.value as any)}
            options={[
              { value: 'ed25519', label: 'ED25519 (recommended)' },
              { value: 'rsa', label: 'RSA' },
              { value: 'ecdsa', label: 'ECDSA' }
            ]}
          />
          {keyType === 'rsa' && (
            <Select
              label="Key Size"
              value={String(keyBits)}
              onChange={(e) => setKeyBits(parseInt(e.target.value))}
              options={[
                { value: '2048', label: '2048 bits' },
                { value: '4096', label: '4096 bits (recommended)' }
              ]}
            />
          )}
          <Input
            label="Passphrase (optional)"
            type="password"
            placeholder="Leave empty for no passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowGenerator(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleGenerate} disabled={!keyName}>
              Generate
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
