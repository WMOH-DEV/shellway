import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { createAgent, utils, type ParsedKey } from 'ssh2'
import type { SSHConnectionConfig } from '../SSHService'

export interface SessionKeyInfo {
  keyAuth: boolean
  fingerprints: string[]
  source: 'key' | 'agent' | 'none'
}

const AGENT_TIMEOUT_MS = 3_000

export function fingerprintOf(key: ParsedKey): string {
  return `SHA256:${createHash('sha256').update(key.getPublicSSH()).digest('base64').replace(/=+$/, '')}`
}

function keyMaterial(config: SSHConnectionConfig): string | Buffer | null {
  if (config.privateKeyData) return config.privateKeyData
  if (!config.privateKeyPath) return null
  try {
    return readFileSync(config.privateKeyPath)
  } catch {
    return null
  }
}

function privateKeyFingerprints(config: SSHConnectionConfig): string[] {
  const material = keyMaterial(config)
  if (!material) return []
  const parsed: unknown = utils.parseKey(material, config.passphrase)
  if (parsed instanceof Error) return []
  return (Array.isArray(parsed) ? parsed : [parsed]).map((key: ParsedKey) => fingerprintOf(key))
}

function agentKeyFingerprint(key: unknown): string | null {
  if (key && typeof key === 'object' && 'getPublicSSH' in key) return fingerprintOf(key as ParsedKey)
  if (typeof key !== 'string' && !Buffer.isBuffer(key)) return null
  const parsed: unknown = utils.parseKey(key)
  return parsed instanceof Error ? null : fingerprintOf((Array.isArray(parsed) ? parsed[0] : parsed) as ParsedKey)
}

function agentFingerprints(): Promise<string[]> {
  const socket = process.env.SSH_AUTH_SOCK
  if (!socket) return Promise.resolve([])
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), AGENT_TIMEOUT_MS)
    createAgent(socket).getIdentities((error, keys) => {
      clearTimeout(timer)
      resolve(error || !keys ? [] : keys.map(agentKeyFingerprint).filter((fingerprint): fingerprint is string => fingerprint !== null))
    })
  })
}

export async function sessionKeyInfo(config: SSHConnectionConfig): Promise<SessionKeyInfo> {
  switch (config.authMethod) {
    case 'publickey':
    case 'publickey+passphrase':
      return { keyAuth: true, fingerprints: privateKeyFingerprints(config), source: 'key' }
    case 'publickey+password':
      return { keyAuth: false, fingerprints: privateKeyFingerprints(config), source: 'key' }
    case 'agent':
      return { keyAuth: true, fingerprints: await agentFingerprints(), source: 'agent' }
    default:
      return { keyAuth: false, fingerprints: [], source: 'none' }
  }
}
