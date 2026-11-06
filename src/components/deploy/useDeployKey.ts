import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/ui/Toast'
import type { SiteConfig } from '@/types/deploy'
import { parseGitHubRepo, type GitHubRepo } from '@/utils/deploy/githubRepo'
import type { KeyAccess } from '@/utils/deploy/readyCheck'
import { copyText } from './copyText'
import { deployApi } from './useDeploySites'

export interface DeployKey {
  github: GitHubRepo | null
  publicKey: string
  keyError: string | null
  token: string
  setToken: (token: string) => void
  remember: boolean
  setRemember: (remember: boolean) => void
  tokenSaved: boolean
  forgetToken: () => void
  registering: boolean
  canRegister: boolean
  access: KeyAccess
  createKey: () => Promise<void>
  copyKey: () => Promise<void>
  register: () => Promise<void>
  testAccess: () => Promise<void>
}

export function useDeployKey(connectionId: string, site: SiteConfig): DeployKey {
  const [publicKey, setPublicKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [tokenSaved, setTokenSaved] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [access, setAccess] = useState<KeyAccess>({ state: 'idle' })
  const github = parseGitHubRepo(site.repoUrl)

  useEffect(() => {
    void deployApi().githubTokenSaved().then((result) => setTokenSaved(result.success && result.data === true))
  }, [])

  const createKey = useCallback(async () => {
    const result = await deployApi().keygen(connectionId, site.name)
    if (result.success && result.data) {
      setPublicKey(result.data)
      setKeyError(null)
    } else {
      setKeyError(result.error ?? 'Could not create the key')
    }
  }, [connectionId, site.name])

  const copyKey = () => copyText(publicKey, 'Key copied')

  const testAccess = useCallback(async () => {
    setAccess({ state: 'checking' })
    const result = await deployApi().checkRemote(connectionId, site.name)
    setAccess(result.success && result.data ? { state: 'ok', head: result.data } : { state: 'failed', message: result.error ?? 'No access' })
  }, [connectionId, site.name])

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
    await testAccess()
  }

  const forgetToken = () => void deployApi().clearGithubToken().then(() => setTokenSaved(false))

  const canRegister = publicKey !== '' && !registering && (tokenSaved || token !== '')

  return { github, publicKey, keyError, token, setToken, remember, setRemember, tokenSaved, forgetToken, registering, canRegister, access, createKey, copyKey, register, testAccess }
}
