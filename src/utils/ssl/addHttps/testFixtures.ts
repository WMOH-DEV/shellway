import type { IssueResult, NameReadiness, PrepFacts, ReadinessCheck, VerifyResult } from '../../../types/ssl'
import { makeOrigin } from '../testReport'

export const ubuntuFacts: PrepFacts = {
  os: { id: 'ubuntu', versionId: '24.04', family: 'debian', pretty: 'Ubuntu 24.04' },
  arch: 'x86_64',
  webServer: 'nginx',
  certbot: null,
  plugins: [],
  snapd: '2.63',
  packageManager: 'apt',
  renewalTimer: null,
  fullSudo: true
}

export const readyFacts: PrepFacts = {
  ...ubuntuFacts,
  certbot: { path: '/usr/local/bin/certbot', version: '3.0.1', method: 'snap' },
  plugins: ['nginx'],
  renewalTimer: 'snap.certbot.renew.timer'
}

export const okCheck = (detail = ''): ReadinessCheck => ({ state: 'ok', detail })
export const failCheck = (detail: string): ReadinessCheck => ({ state: 'fail', detail })

export const readinessRow = (name: string, overrides: Partial<NameReadiness> = {}): NameReadiness => ({
  name,
  dns: okCheck('points to this server'),
  port80: okCheck('reachable'),
  cloudflare: null,
  ...overrides
})

export const issueFailure = (overrides: Partial<IssueResult> = {}): IssueResult => ({
  ok: false,
  failedStage: 'staging',
  restored: false,
  backupPath: '/etc/ssl/shellway/backups/app.conf.1800000000',
  lineage: null,
  output: 'Challenge failed for app.example.com',
  hint: null,
  ...overrides
})

export const issueSuccess = (overrides: Partial<IssueResult> = {}): IssueResult =>
  issueFailure({ ok: true, failedStage: null, lineage: 'app.example.com', output: 'Congratulations!', ...overrides })

export const verifyResult = (overrides: Partial<VerifyResult> = {}): VerifyResult => ({
  names: [{ name: 'app.example.com', served: makeOrigin({ names: ['app.example.com'] }), https: okCheck('200') }],
  renewalTest: okCheck('dry run passed'),
  timer: okCheck('snap.certbot.renew.timer'),
  ...overrides
})
