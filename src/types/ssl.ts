export type CertKind = 'letsencrypt' | 'cloudflare-origin' | 'self-signed' | 'other' | 'none'

export type Verdict = 'broken' | 'will-break' | 'expiring' | 'not-encrypted' | 'unchecked' | 'ok'

export type SslMode = 'off' | 'flexible' | 'full' | 'strict' | 'origin_pull'

export type CheckedSide = 'cloudflare' | 'server'

export interface ServerBlock {
  id: string
  file: string
  line: number
  names: string[]
  tls: boolean
  certPath: string
  keyPath: string
  probeAddress: string
}

export interface OriginCert {
  kind: CertKind
  subject: string
  issuer: string
  names: string[]
  notBefore: number | null
  notAfter: number | null
  error: string | null
}

export interface CertbotLineage {
  name: string
  domains: string[]
  notAfter: number | null
  certPath: string
  keyPath: string
}

export type RenewalMechanism = 'certbot.timer' | 'snap.certbot.renew.timer' | 'cron' | 'none'
export type RunResult = 'success' | 'failed' | 'unknown'

export interface RenewalInfo {
  mechanism: RenewalMechanism
  lastRun: number | null
  lastResult: RunResult
  output: string
}

export type NginxParse = 'full' | 'partial' | 'unavailable'

export interface ServerFacts {
  nginx: string | null
  openssl: string | null
  certbot: string | null
  otherWebServer: 'apache' | 'caddy' | null
  nginxParse: NginxParse
  renewal: RenewalInfo
  sudo: { certbot: boolean; nginx: boolean; full: boolean }
  paths: { certbot: string | null; nginx: string | null }
  user: string
  addresses: string[]
}

export interface ServerScan {
  facts: ServerFacts
  blocks: ServerBlock[]
  lineages: CertbotLineage[]
  origins: Record<string, OriginCert>
}

export type EdgeState = 'proxied' | 'dns-only' | 'not-on-cloudflare' | 'elsewhere' | 'unknown'

export interface EdgeInfo {
  state: EdgeState
  zone: string | null
  recordType: string | null
  recordContent: string | null
  sslMode: SslMode | null
  unknownReason: string | null
}

export interface HostnameStatus {
  name: string
  blockId: string
  wildcard: boolean
  origin: OriginCert | null
  lineage: string | null
  edge: EdgeInfo
  verdict: Verdict
  reason: string
  uncheckedSide: CheckedSide | null
}

export interface SslReport {
  checkedAt: number
  facts: ServerFacts
  blocks: ServerBlock[]
  lineages: CertbotLineage[]
  hostnames: HostnameStatus[]
  cloudflare: CloudflareStatus
}

export type PermissionState = 'granted' | 'missing' | 'not-granted' | 'unknown'
export type PermissionGroupId = 'monitoring' | 'origin-ca' | 'zone-mode'

export interface PermissionLine {
  label: string
  state: PermissionState
}

export interface PermissionGroup {
  id: PermissionGroupId
  state: PermissionState
  lines: PermissionLine[]
}

export interface CloudflareZone {
  id: string
  name: string
}

export interface CloudflareStatus {
  saved: boolean
  tokenHint: string
  error: string | null
  permissions: PermissionGroup[]
  zones: CloudflareZone[]
}

export type CertbotAction = 'test' | 'renew' | 'force'

export interface ActionResult {
  code: number
  output: string
}

export interface UnreachableHost {
  host: string
  reason: string
  at: number
}

export interface AlertSettings {
  probeEnabled: boolean
  lastAlert: { host: string; verdict: Verdict; at: number } | null
  unreachable: UnreachableHost[]
}

export interface SslResult<T = undefined> {
  success: boolean
  data?: T
  error?: string
}
