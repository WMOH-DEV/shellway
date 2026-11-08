export type CertKind = 'letsencrypt' | 'cloudflare-origin' | 'self-signed' | 'other' | 'none'

export type Verdict = 'broken' | 'will-break' | 'expiring' | 'not-encrypted' | 'unchecked' | 'no-dns' | 'ok'

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
  root: string | null
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

export type ApacheLayout = 'debian' | 'rhel'

export interface ApacheFacts {
  version: string | null
  layout: ApacheLayout | null
}

export type ServingWebServer = 'nginx' | 'apache' | 'caddy'

export interface ServerFacts {
  nginx: string | null
  apache: ApacheFacts | null
  serving: ServingWebServer | null
  openssl: string | null
  certbot: string | null
  otherWebServer: 'apache' | 'caddy' | null
  nginxParse: NginxParse
  renewal: RenewalInfo
  sudo: { certbot: boolean; nginx: boolean; apache: boolean; full: boolean; installed: boolean }
  paths: { certbot: string | null; nginx: string | null; apache: string | null }
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
  noRecord?: boolean
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
export type PermissionGroupId = 'monitoring' | 'origin-ca' | 'zone-mode' | 'dns-records'

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

export type CheckState = 'ok' | 'fail' | 'unknown'

export interface ReadinessCheck {
  state: CheckState
  detail: string
}

export interface NameReadiness {
  name: string
  dns: ReadinessCheck
  port80: ReadinessCheck
  cloudflare: string | null
}

export type OsFamily = 'debian' | 'rhel' | 'other'
export type PackageManager = 'apt' | 'dnf' | 'yum'
export type WebServerKind = 'nginx' | 'apache' | 'caddy'
export type EditableWebServer = 'nginx' | 'apache'
export type CertbotInstallMethod = 'snap' | 'apt' | 'dnf' | 'yum' | 'pip' | 'unknown'

export interface PrepFacts {
  os: { id: string; versionId: string; family: OsFamily; pretty: string }
  arch: string
  webServer: WebServerKind | null
  certbot: { path: string; version: string; method: CertbotInstallMethod } | null
  plugins: string[]
  snapd: string | null
  packageManager: PackageManager | null
  renewalTimer: string | null
  fullSudo: boolean
}

export type InstallRoute = 'snap' | 'distro'
export type InstallStepStatus = 'run' | 'skip' | 'check'

export interface InstallStep {
  id: string
  command: string
  why: string
  status: InstallStepStatus
  skipReason: string | null
}

export interface InstallPlan {
  route: InstallRoute
  routes: InstallRoute[]
  needed: boolean
  steps: InstallStep[]
  blockedReason: string | null
  docsUrl: string
}

export interface IssueRequest {
  blockId: string
  names: string[]
  email: string
  redirect: boolean
  staging: boolean
}

export type IssueStage = 'backup' | 'staging' | 'issue' | 'nginx-test' | 'restore'

export interface IssueResult {
  ok: boolean
  failedStage: IssueStage | null
  restored: boolean
  backupPath: string | null
  lineage: string | null
  output: string
  hint: string | null
}

export interface VerifyName {
  name: string
  served: OriginCert | null
  https: ReadinessCheck
}

export interface VerifyResult {
  names: VerifyName[]
  renewalTest: ReadinessCheck
  timer: ReadinessCheck
}

export interface SslResult<T = undefined> {
  success: boolean
  data?: T
  error?: string
}

export type OriginKeyType = 'ecc' | 'rsa'
export type OriginValidityYears = 1 | 2 | 3 | 15

export interface SwitchName {
  name: string
  ok: boolean
  reason: string | null
}

export interface SwitchCheck {
  blockId: string
  names: SwitchName[]
  blockedReason: string | null
}

export interface SwitchRequest {
  blockId: string
  keyType: OriginKeyType
  validityYears: OriginValidityYears
}

export type DiffKind = 'same' | 'add' | 'remove'

export interface DiffLine {
  kind: DiffKind
  oldLine: number | null
  newLine: number | null
  text: string
}

export interface SwitchPrepared {
  switchId: string
  blockId: string
  file: string
  blockLine: number
  names: string[]
  certPath: string
  keyPath: string
  keyType: OriginKeyType
  validityYears: OriginValidityYears
  notAfter: number | null
  backupPath: string
  diff: DiffLine[]
  script: string
  webServer: EditableWebServer
  apacheLayout: ApacheLayout | null
}

export type SwitchStage = 'apply' | 'nginx-test' | 'verify'

export interface SwitchVerifyName {
  name: string
  served: OriginCert | null
  https: ReadinessCheck
}

export interface SwitchResult {
  ok: boolean
  failedStage: SwitchStage | null
  restored: boolean
  backupPath: string | null
  output: string
  verify: SwitchVerifyName[]
}

export interface SwitchLeftover {
  name: string
  blockId: string
  lineage: string
  lineageShared: boolean
  backupPath: string | null
  undoable: boolean
}

export type ZoneProbeState = 'pass' | 'fail' | 'unknown'

export interface ZoneHostProbe {
  name: string
  recordType: string
  origin: string
  state: ZoneProbeState
  detail: string
}

export interface ZonePreflight {
  zoneId: string
  zone: string
  currentMode: SslMode | null
  hosts: ZoneHostProbe[]
  blockedReason: string | null
}

export interface ZoneModeResult {
  zone: string
  previousMode: SslMode | null
  mode: SslMode
}
