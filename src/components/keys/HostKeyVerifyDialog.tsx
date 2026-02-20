import { useState } from 'react'
import { ShieldAlert, ShieldCheck, AlertTriangle, Copy } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { toast } from '@/components/ui/Toast'

interface HostKeyVerifyDialogProps {
  /** 'new' = unknown host, 'changed' = host key mismatch */
  type: 'new' | 'changed'
  host: string
  port: number
  keyType: string
  fingerprint: string
  previousFingerprint?: string
  previousTrustedDate?: string
  onCancel: () => void
  onTrustOnce?: () => void
  onTrustAndSave?: () => void
  onAcceptNewKey?: () => void
  onDisconnect?: () => void
}

/**
 * Modal dialog for host key verification.
 * - New host: shows key info with Trust Once / Trust & Save options.
 * - Changed host: RED WARNING with Disconnect (prominent) / Accept New Key.
 */
export function HostKeyVerifyDialog({
  type,
  host,
  port,
  keyType,
  fingerprint,
  previousFingerprint,
  previousTrustedDate,
  onCancel,
  onTrustOnce,
  onTrustAndSave,
  onAcceptNewKey,
  onDisconnect
}: HostKeyVerifyDialogProps) {
  const [alwaysTrust, setAlwaysTrust] = useState(false)

  const copyFingerprint = (fp: string) => {
    navigator.clipboard.writeText(fp)
    toast.info('Fingerprint copied')
  }

  if (type === 'changed') {
    return (
      <Modal
        open
        onClose={onDisconnect || onCancel}
        closeOnBackdrop={false}
        closeOnEscape={false}
        maxWidth="max-w-md"
      >
        <div className="flex flex-col gap-4">
          {/* Warning header */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <ShieldAlert size={24} className="text-red-400 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-red-400">HOST KEY CHANGED — POTENTIAL SECURITY RISK</h3>
            </div>
          </div>

          <p className="text-sm text-nd-text-secondary">
            The host key for <strong className="text-nd-text-primary font-mono">{host}:{port}</strong> has
            changed{previousTrustedDate ? ` since it was last trusted on ${previousTrustedDate}` : ''}.
          </p>

          {/* Fingerprints comparison */}
          <div className="flex flex-col gap-2">
            {previousFingerprint && (
              <div className="flex flex-col gap-0.5">
                <label className="text-2xs font-medium text-nd-text-muted">Previous Fingerprint</label>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-red-300 bg-nd-bg-primary px-2 py-1 rounded border border-nd-border flex-1 break-all">
                    {previousFingerprint}
                  </code>
                  <button onClick={() => copyFingerprint(previousFingerprint)} className="p-1 text-nd-text-muted hover:text-nd-text-primary">
                    <Copy size={12} />
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              <label className="text-2xs font-medium text-nd-text-muted">Current Fingerprint</label>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-nd-warning bg-nd-bg-primary px-2 py-1 rounded border border-nd-border flex-1 break-all">
                  {fingerprint}
                </code>
                <button onClick={() => copyFingerprint(fingerprint)} className="p-1 text-nd-text-muted hover:text-nd-text-primary">
                  <Copy size={12} />
                </button>
              </div>
            </div>
          </div>

          {/* Explanation */}
          <div className="text-xs text-nd-text-muted space-y-1">
            <p>This could indicate:</p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li>The server was reinstalled or reconfigured</li>
              <li>A man-in-the-middle attack</li>
            </ul>
            <p className="mt-2">Contact your server administrator to verify.</p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onAcceptNewKey}>
              Accept New Key
            </Button>
            <Button variant="danger" onClick={onDisconnect || onCancel}>
              Disconnect
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  // New host key
  return (
    <Modal
      open
      onClose={onCancel}
      closeOnBackdrop={false}
      closeOnEscape={false}
      maxWidth="max-w-md"
    >
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-nd-accent/10 border border-nd-accent/30">
          <ShieldCheck size={24} className="text-nd-accent shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-nd-text-primary">Unknown Host Key</h3>
          </div>
        </div>

        <p className="text-sm text-nd-text-secondary">
          The server <strong className="text-nd-text-primary font-mono">{host}:{port}</strong> presented
          a host key that is not in your trusted keys database.
        </p>

        {/* Key details */}
        <div className="flex flex-col gap-2 bg-nd-bg-primary rounded-lg border border-nd-border p-3">
          <div className="flex gap-3 text-xs">
            <span className="text-nd-text-muted w-20">Key type:</span>
            <span className="text-nd-text-primary font-mono">{keyType}</span>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-nd-text-muted w-20 shrink-0">Fingerprint:</span>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <code className="text-nd-text-primary font-mono break-all text-2xs">{fingerprint}</code>
              <button onClick={() => copyFingerprint(fingerprint)} className="p-0.5 text-nd-text-muted hover:text-nd-text-primary shrink-0">
                <Copy size={11} />
              </button>
            </div>
          </div>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2 text-xs text-nd-warning">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Verify this fingerprint with your server administrator before trusting.</span>
        </div>

        {/* Always trust checkbox */}
        <Toggle
          checked={alwaysTrust}
          onChange={setAlwaysTrust}
          label="Always trust this host (don't ask again)"
        />

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onTrustOnce}>
            Trust Once
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (alwaysTrust) onTrustAndSave?.()
              else onTrustOnce?.()
            }}
          >
            {alwaysTrust ? 'Trust & Save' : 'Trust Once'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
