import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { githubDeployKeysUrl } from '@/utils/deploy/githubRepo'
import type { ReadyAction } from '@/utils/deploy/readyCheck'
import { GithubTokenFields } from '../GithubTokenFields'
import type { DeployKey } from '../useDeployKey'

interface KeyActionsProps {
  deployKey: DeployKey
  actions: ReadyAction[]
}

function ByHandHint({ deployKey }: { deployKey: DeployKey }) {
  const { github } = deployKey
  if (!github) return null
  return (
    <div className="flex flex-col gap-1.5 text-2xs text-nd-text-secondary">
      <span>Paste the key above as a deploy key, leave write access off, then press Test access.</span>
      <a className="inline-flex items-center gap-1 text-xs text-nd-accent hover:underline" href={githubDeployKeysUrl(github)} target="_blank" rel="noreferrer">
        Open the repository deploy keys page <ExternalLink size={11} />
      </a>
    </div>
  )
}

function TokenForm({ deployKey }: { deployKey: DeployKey }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-nd-border bg-nd-surface p-3">
      <GithubTokenFields deployKey={deployKey} />
      <div>
        <Button variant="primary" size="sm" onClick={() => void deployKey.register()} disabled={!deployKey.canRegister}>
          {deployKey.registering ? 'Adding…' : 'Add read-only key'}
        </Button>
      </div>
    </div>
  )
}

export function KeyActions({ deployKey, actions }: KeyActionsProps) {
  const [tokenOpen, setTokenOpen] = useState(false)
  const [byHandOpen, setByHandOpen] = useState(false)
  const { publicKey, keyError, access, registering } = deployKey
  const offers = (action: ReadyAction) => actions.includes(action)

  const addToGitHub = () => (deployKey.tokenSaved ? void deployKey.register() : setTokenOpen((open) => !open))

  return (
    <div className="flex flex-col gap-2.5">
      {keyError && <span className="text-xs text-nd-error-fg">{keyError}</span>}
      <div className="flex flex-wrap items-center gap-2">
        {offers('add-to-github') && (
          <Button variant="primary" size="sm" onClick={addToGitHub} disabled={!publicKey || registering}>
            {registering ? 'Adding…' : 'Add it to GitHub for me'}
          </Button>
        )}
        {offers('test-access') && (
          <Button size="sm" onClick={() => void deployKey.testAccess()} disabled={!publicKey || access.state === 'checking'}>
            {access.state === 'checking' ? 'Checking…' : 'Test access'}
          </Button>
        )}
        {offers('add-by-hand') && (
          <button type="button" className="ml-1 text-xs text-nd-accent hover:underline" onClick={() => setByHandOpen((open) => !open)}>
            Add it by hand instead
          </button>
        )}
      </div>
      {tokenOpen && !deployKey.tokenSaved && <TokenForm deployKey={deployKey} />}
      {byHandOpen && <ByHandHint deployKey={deployKey} />}
    </div>
  )
}
