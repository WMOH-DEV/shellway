import { useEffect } from 'react'
import { Check, Copy, ExternalLink, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { SiteConfig } from '@/types/deploy'
import { githubDeployKeysUrl } from '@/utils/deploy/githubRepo'
import { GithubTokenFields } from './GithubTokenFields'
import { useDeployKey } from './useDeployKey'

interface KeySetupProps {
  connectionId: string
  site: SiteConfig
  onDone: () => void
}

export function KeySetup({ connectionId, site, onDone }: KeySetupProps) {
  const deployKey = useDeployKey(connectionId, site)
  const { github, publicKey, keyError, access, createKey } = deployKey

  useEffect(() => { void createKey() }, [createKey])

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-nd-accent" />
        <h2 className="text-sm font-semibold text-nd-text-primary">Give the server read-only access to {github ? `${github.owner}/${github.repo}` : 'the repository'}</h2>
      </div>
      <p className="text-xs text-nd-text-secondary">
        The server made its own key that can only read this one repository. Your personal git access never leaves this PC.
      </p>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-nd-text-secondary">Server public key</span>
          <Button size="sm" variant="ghost" onClick={() => void deployKey.copyKey()} disabled={!publicKey}><Copy size={12} /> Copy</Button>
        </div>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md border border-nd-border bg-nd-bg-sunken p-2 font-mono text-2xs text-nd-text-primary">
          {keyError ?? (publicKey || 'Creating key…')}
        </pre>
      </div>

      {github && (
        <div className="flex flex-col gap-2 rounded-lg border border-nd-border bg-nd-surface p-3">
          <span className="text-xs font-medium text-nd-text-primary">Add it to GitHub for me</span>
          <GithubTokenFields deployKey={deployKey} />
          <div>
            <Button variant="primary" size="sm" onClick={() => void deployKey.register()} disabled={!deployKey.canRegister}>
              {deployKey.registering ? 'Adding…' : 'Add read-only key'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-nd-border bg-nd-surface p-3">
        <span className="text-xs font-medium text-nd-text-primary">{github ? 'Or add it yourself' : 'Add it as a read-only deploy key in your git host'}</span>
        {github && (
          <a
            className="inline-flex items-center gap-1 text-xs text-nd-accent hover:underline"
            href={githubDeployKeysUrl(github)}
            target="_blank"
            rel="noreferrer"
          >
            Open the repository deploy keys page <ExternalLink size={11} />
          </a>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void deployKey.testAccess()} disabled={!publicKey || access.state === 'checking'}>
            {access.state === 'checking' ? 'Checking…' : 'Test access'}
          </Button>
          {access.state === 'ok' && <span className="flex items-center gap-1 text-xs text-nd-success-fg"><Check size={12} /> The server can read {site.branch} ({access.head.slice(0, 7)})</span>}
          {access.state === 'failed' && <span className="text-xs text-nd-error-fg">{access.message}</span>}
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant={access.state === 'ok' ? 'primary' : 'ghost'} onClick={onDone}>{access.state === 'ok' ? 'Done' : 'Skip for now'}</Button>
      </div>
    </div>
  )
}
