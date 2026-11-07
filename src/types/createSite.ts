import type { SourceMode } from './deploy'
import type { ApacheLayout } from './ssl'

export type TemplateId = 'laravel' | 'node' | 'static' | 'php' | 'compose' | 'blank'

export type SiteServer = { kind: 'nginx' } | { kind: 'apache'; layout: ApacheLayout }

export interface ServerTools {
  phpFpm: string | null
  composer: boolean
  node: string | null
  pm2: boolean
  docker: boolean
  apacheModules: string[]
  freeDiskBytes: number
}

export interface DnsInput {
  zoneId: string | null
  zoneName: string | null
  serverIp: string
  proxied: boolean
}

export interface HttpsInput {
  email: string
  redirect: boolean
  staging: boolean
}

export interface CreateSiteInput {
  domain: string
  includeWww: boolean
  siteName: string
  folder: string
  owner: string
  template: TemplateId
  server: SiteServer
  phpVersion: string
  appPort: number
  repoUrl: string
  branch: string
  sourceMode: SourceMode
  pollMinutes: number
  dns: DnsInput | null
  https: HttpsInput
  healthPath: string
}

export type PlanActionId = 'folder' | 'modules' | 'site' | 'dns' | 'https' | 'deploys' | 'first-deploy'

export type PlanChip = 'new' | 'ready' | 'needs you' | 'installs' | 'blocked' | `${number} to enable`

export interface DnsRecordPlan {
  type: 'A' | 'CNAME'
  name: string
  content: string
  proxied: boolean
}

export interface PlanAction {
  id: PlanActionId
  title: string
  summary: string
  chip: PlanChip
  commands: string[]
  script: string | null
  config: string | null
  records: DnsRecordPlan[]
  note: string
}

export interface PlanMeta {
  minutes: number
  needsFullSudo: boolean
}

export type RunStepStatus = 'done' | 'failed' | 'skipped' | 'pending'

export interface RunStep {
  id: PlanActionId
  status: RunStepStatus
  startedAt: number | null
  finishedAt: number | null
}

export interface CreatedDnsRecord {
  zoneId: string
  recordId: string
  name: string
  type: DnsRecordPlan['type']
}

export interface CreatedResources {
  folder: { path: string; createdByRun: boolean } | null
  siteFile: { path: string; enabledLink: string | null; sha256: string } | null
  modulesEnabled: string[]
  dnsRecords: CreatedDnsRecord[]
  certificate: { lineage: string; issuedByRun: boolean } | null
  deploySite: string | null
}

export interface RunRecord {
  id: string
  sessionId: string
  domain: string
  createdAt: number
  server: SiteServer
  steps: RunStep[]
  created: CreatedResources
}
