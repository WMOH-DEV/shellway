import type { DiffLine, SslReport, SwitchLeftover, SwitchPrepared, SwitchResult } from '../../../types/ssl'
import { okCheck } from '../addHttps/testFixtures'
import { connectedCloudflare, DAY, makeBlock, makeFacts, makeHost, makeOrigin, makeReport, NOW } from '../testReport'

export const switchBlock = makeBlock({
  id: 'app.conf:9',
  file: '/etc/nginx/sites-enabled/app.conf',
  line: 9,
  names: ['app.example.com', 'www.app.example.com']
})

export function switchReport(overrides: Partial<SslReport> = {}): SslReport {
  return makeReport({
    blocks: [switchBlock],
    hostnames: [
      makeHost({ name: 'app.example.com', blockId: switchBlock.id }),
      makeHost({ name: 'www.app.example.com', blockId: switchBlock.id })
    ],
    facts: makeFacts({ sudo: { certbot: true, nginx: true, full: true } }),
    cloudflare: { ...connectedCloudflare, permissions: [{ id: 'origin-ca', state: 'granted', lines: [] }] },
    ...overrides
  })
}

export const SWITCH_DIFF: DiffLine[] = [
  { kind: 'same', oldLine: 8, newLine: 8, text: 'server {' },
  { kind: 'remove', oldLine: 9, newLine: null, text: '    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;' },
  { kind: 'remove', oldLine: 10, newLine: null, text: '    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;' },
  { kind: 'add', oldLine: null, newLine: 9, text: '    ssl_certificate /etc/ssl/shellway/app.example.com.pem;' },
  { kind: 'add', oldLine: null, newLine: 10, text: '    ssl_certificate_key /etc/ssl/shellway/app.example.com.key;' },
  { kind: 'same', oldLine: 11, newLine: 11, text: '    include /etc/letsencrypt/options-ssl-nginx.conf;' }
]

export const preparedSwitch = (overrides: Partial<SwitchPrepared> = {}): SwitchPrepared => ({
  switchId: 'switch-1',
  blockId: switchBlock.id,
  file: switchBlock.file,
  blockLine: 9,
  names: ['app.example.com', 'www.app.example.com'],
  certPath: '/etc/ssl/shellway/app.example.com.pem',
  keyPath: '/etc/ssl/shellway/app.example.com.key',
  keyType: 'ecc',
  validityYears: 15,
  notAfter: NOW + 15 * 365 * DAY,
  backupPath: '/etc/ssl/shellway/backups/app.example.com-20261106.conf',
  diff: SWITCH_DIFF,
  script: 'set -eu\ncp /etc/nginx/sites-enabled/app.conf /etc/ssl/shellway/backups/app.example.com-20261106.conf',
  ...overrides
})

export const switchApplied = (overrides: Partial<SwitchResult> = {}): SwitchResult => ({
  ok: true,
  failedStage: null,
  restored: false,
  backupPath: '/etc/ssl/shellway/backups/app.example.com-20261106.conf',
  output: 'nginx: configuration file test is successful',
  verify: ['app.example.com', 'www.app.example.com'].map((name) => ({
    name,
    served: makeOrigin({ kind: 'cloudflare-origin', names: [name], notAfter: NOW + 15 * 365 * DAY }),
    https: okCheck('200')
  })),
  ...overrides
})

export const switchFailed = (overrides: Partial<SwitchResult> = {}): SwitchResult =>
  switchApplied({ ok: false, failedStage: 'nginx-test', restored: true, output: 'nginx: [emerg] unexpected "}"', verify: [], ...overrides })

export const leftoverOf = (overrides: Partial<SwitchLeftover> = {}): SwitchLeftover => ({
  name: 'app.example.com',
  blockId: switchBlock.id,
  lineage: 'app.example.com',
  lineageShared: false,
  backupPath: '/etc/ssl/shellway/backups/app.example.com-20261106.conf',
  undoable: true,
  ...overrides
})
