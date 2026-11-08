import Store from 'electron-store'
import { encrypt, decrypt, generateMasterKey } from '../../utils/encryption'

interface Schema {
  masterKey: string
  githubToken: string
  sessions: string[]
  lastSeen: Record<string, number>
}

export class DeployLocalStore {
  private readonly store = new Store<Schema>({
    name: 'shellway-deploy',
    defaults: { masterKey: '', githubToken: '', sessions: [], lastSeen: {} }
  })

  private readonly masterKey: string

  constructor() {
    let key = this.store.get('masterKey')
    if (!key) {
      key = generateMasterKey()
      this.store.set('masterKey', key)
    }
    this.masterKey = key
  }

  githubToken(): string | null {
    const stored = this.store.get('githubToken')
    if (!stored) return null
    try {
      return decrypt(stored, this.masterKey)
    } catch {
      return null
    }
  }

  setGithubToken(token: string | null): void {
    this.store.set('githubToken', token ? encrypt(token, this.masterKey) : '')
  }

  usesDeploy(sessionId: string): boolean {
    return this.store.get('sessions').includes(sessionId)
  }

  markUsesDeploy(sessionId: string): void {
    const sessions = this.store.get('sessions')
    if (!sessions.includes(sessionId)) this.store.set('sessions', [...sessions, sessionId])
  }

  lastSeen(sessionId: string, site: string): number {
    return this.store.get('lastSeen')[`${sessionId}:${site}`] ?? 0
  }

  setLastSeen(sessionId: string, site: string, timestamp: number): void {
    this.store.set('lastSeen', { ...this.store.get('lastSeen'), [`${sessionId}:${site}`]: timestamp })
  }
}
