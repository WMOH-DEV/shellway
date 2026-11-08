import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import type { DeployKey } from './useDeployKey'

export function GithubTokenFields({ deployKey }: { deployKey: DeployKey }) {
  const { token, setToken, remember, setRemember, tokenSaved, forgetToken } = deployKey
  if (tokenSaved) {
    return (
      <div className="flex items-center gap-2 text-2xs text-nd-text-secondary">
        Using your saved token.
        <button type="button" className="text-nd-accent hover:underline" onClick={forgetToken}>Forget it</button>
      </div>
    )
  }
  return (
    <>
      <Input
        type="password"
        label="GitHub token (fine-grained, this repo, Administration: read and write)"
        value={token}
        onChange={(e) => setToken(e.target.value.trim())}
      />
      <Toggle checked={remember} onChange={setRemember} label="Remember the token on this PC" />
    </>
  )
}
