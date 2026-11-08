import type { RunRecord, ServerTools } from '../../../src/types/createSite'
import type { DeployRecord, SiteConfig } from '../../../src/types/deploy'
import type { IssueRequest, IssueResult } from '../../../src/types/ssl'
import type { RemoteExec } from '../deploy/DeployService'
import type { DnsRecord, NewDnsRecord } from '../ssl/CloudflareClient'

export interface DnsPort {
  find: (zoneId: string, name: string) => Promise<DnsRecord[]>
  create: (zoneId: string, record: NewDnsRecord) => Promise<DnsRecord>
  remove: (zoneId: string, recordId: string) => Promise<void>
}

export interface DeployPort {
  ensureRunner: () => Promise<void>
  siteNames: () => Promise<string[]>
  save: (config: SiteConfig) => Promise<void>
  remove: (name: string) => Promise<void>
  keygen: (name: string) => Promise<string>
  writeEnv: (name: string, content: string) => Promise<void>
  repoError: (name: string) => Promise<string | null>
  deployAndWait: (name: string) => Promise<DeployRecord | null>
}

export interface ProjectPort {
  githubLogin: () => Promise<string | null>
  githubRepoExists: (owner: string, name: string) => Promise<boolean>
  createGithubRepo: (name: string, isPrivate: boolean) => Promise<{ sshUrl: string; httpsUrl: string }>
  registerDeployKey: (owner: string, name: string, title: string, publicKey: string) => Promise<void>
  remoteHeads: (url: string) => Promise<string[]>
  makeFolder: (path: string) => Promise<void>
  removeFolder: (path: string) => Promise<void>
  writeFiles: (dir: string, files: Record<string, string>) => Promise<void>
  extractArchive: (dir: string, base64: string) => Promise<void>
  readFile: (dir: string, path: string) => Promise<string | null>
  commit: (dir: string, branch: string, message: string) => Promise<string>
  push: (dir: string, url: string, branch: string) => Promise<void>
}

export type OutputWriter = (chunk: string) => void

export interface CreateSitePorts {
  exec: RemoteExec
  dns: DnsPort | null
  deploy: DeployPort
  project: ProjectPort
  tools: () => Promise<ServerTools>
  siteBlockId: (file: string, domain: string) => Promise<string | null>
  issue: (request: IssueRequest, onOutput: OutputWriter) => Promise<IssueResult>
  resolves: (name: string, address: string) => Promise<boolean>
  save: (record: RunRecord) => void
  output: OutputWriter
  now: () => number
}
