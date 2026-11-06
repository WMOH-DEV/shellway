import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { toast } from '@/components/ui/Toast'
import type { SiteConfig } from '@/types/deploy'
import { parseGitHubRepo } from '@/utils/deploy/githubRepo'
import { deployApi } from './useDeploySites'

interface KeySetupProps {
  connectionId: string
  site: SiteConfig
  onDone: () => void
}

type Access = { state: 'idle' | 'checking' } | { state: 'ok'; head: string } | { state: 'failed'; message: string }

export function KeySetup({ connectionId, site, onDone }: KeySetupProps) {
  const [publicKey, setPublicKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [tokenSaved, setTokenSaved] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [access, setAccess] = useState<Access>({ state: 'idle' })
  const github = parseGitHubRepo(site.repoUrl)

  useEffect(() => {
    void deployApi().keygen(connectionId, site.name).then((result) => {
      if (result.success && result.data) setPublicKey(result.data)
      else setKeyError(result.error ?? 'Could not create the key')
    })
    void deployApi().githubTokenSaved().then((result) => setTokenSaved(result.success && result.data === true))
  }, [connectionId, site.name])

  const copyKey = async () => {
    await navigator.clipboard.writeText(publicKey)
    toast.success('Key copied')
  }

  const register = async () => {
    setRegistering(true)
    const result = await deployApi().registerKey(connectionId, site.name, token || null, remember)
    setRegistering(false)
    if (!result.success) {
      toast.error('GitHub did not accept the key', result.error)
      return
    }
    toast.success(result.data?.alreadyAdded ? 'The key was already on GitHub' : 'Read-only key added to GitHub')
    setToken('')
    if (remember && token) setTokenSaved(true)
    void testAccess()
  }

  const testAccess = async () => {
    setAccess({ state: 'checking' })
    const result = await deployApi().checkRemote(connectionId, site.name)
    setAccess(result.success && result.data ? { state: 'ok', head: result.data } : { state: 'failed', message: result.error ?? 'No access' })
  }

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
          <Button size="sm" variant="ghost" onClick={() => void copyKey()} disabled={!publicKey}><Copy size={12} /> Copy</Button>
        </div>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md border border-nd-border bg-nd-surface p-2 font-mono text-2xs text-nd-text-primary">
          {keyError ?? (publicKey || 'Creating key…')}
        </pre>
      </div>

      {github && (
        <div className="flex flex-col gap-2 rounded-lg border border-nd-border bg-nd-bg-secondary p-3">
          <span className="text-xs font-medium text-nd-text-primary">Add it to GitHub for me</span>
          {!tokenSaved && (
            <>
              <Input
                type="password"
                label="GitHub token (fine-grained, this repo, Administration: read and write)"
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
              />
              <Toggle checked={remember} onChange={setRemember} label="Remember the token on this PC" />
            </>
          )}
          {tokenSaved && (
            <div className="flex items-center gap-2 text-2xs text-nd-text-secondary">
              Using your saved token.
              <button type="button" className="text-nd-accent hover:underline" onClick={() => void deployApi().clearGithubToken().then(() => setTokenSaved(false))}>Forget it</button>
            </div>
          )}
          <div>
            <Button variant="primary" size="sm" onClick={() => void register()} disabled={!publicKey || registering || (!tokenSaved && !token)}>
              {registering ? 'Adding…' : 'Add read-only key'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-nd-border bg-nd-bg-secondary p-3">
        <span className="text-xs font-medium text-nd-text-primary">{github ? 'Or add it yourself' : 'Add it as a read-only deploy key in your git host'}</span>
        {github && (
          <a
            className="inline-flex items-center gap-1 text-xs text-nd-accent hover:underline"
            href={`https://github.com/${github.owner}/${github.repo}/settings/keys/new`}
            target="_blank"
            rel="noreferrer"
          >
            Open the repository deploy keys page <ExternalLink size={11} />
          </a>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void testAccess()} disabled={!publicKey || access.state === 'checking'}>
            {access.state === 'checking' ? 'Checking…' : 'Test access'}
          </Button>
          {access.state === 'ok' && <span className="flex items-center gap-1 text-xs text-nd-success"><Check size={12} /> The server can read {site.branch} ({access.head.slice(0, 7)})</span>}
          {access.state === 'failed' && <span className="text-xs text-nd-error">{access.message}</span>}
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant={access.state === 'ok' ? 'primary' : 'ghost'} onClick={onDone}>{access.state === 'ok' ? 'Done' : 'Skip for now'}</Button>
      </div>
    </div>
  )
}
