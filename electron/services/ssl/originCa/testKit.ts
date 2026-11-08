import type { OriginCert, SslReport } from '../../../../src/types/ssl'
import { DAY, NOW, connectedCloudflare, makeBlock, makeFacts, makeHost, makeOrigin, makeReport } from '../../../../src/utils/ssl/testReport'
import type { RemoteExec } from '../../deploy/DeployService'

export const FILE = '/etc/nginx/sites-enabled/app.conf'
export const NAMES = ['app.example.com', 'www.example.com']
export const KEY_PATH = '/etc/ssl/shellway/app.example.com-1800000000.key'
export const CERT_PATH = '/etc/ssl/shellway/app.example.com-1800000000.pem'
export const BACKUP_PATH = '/etc/ssl/shellway/backups/app.example.com-1800000000.conf'
export const CSR = '-----BEGIN CERTIFICATE REQUEST-----\nMIIBcsr\n-----END CERTIFICATE REQUEST-----\n'
export const PEM = '-----BEGIN CERTIFICATE-----\nMIIBsample\n-----END CERTIFICATE-----\n'

export const SITE = [
  '# one', '# two', '# three', '# four', '# five', '# six', '# seven', '# eight',
  'server {',
  '    server_name app.example.com www.example.com;',
  '    listen 443 ssl;',
  '    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem; # managed by Certbot',
  '    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem; # managed by Certbot',
  '    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot',
  '}',
  ''
].join('\n')

const originPermission = { id: 'origin-ca' as const, state: 'granted' as const, lines: [] }

export function readyReport(overrides: Partial<SslReport> = {}): SslReport {
  return makeReport({
    facts: makeFacts({ sudo: { certbot: true, nginx: true, apache: false, full: true, installed: true } }),
    blocks: [makeBlock({ names: NAMES })],
    hostnames: NAMES.map((name) => makeHost({ name })),
    cloudflare: { ...connectedCloudflare, permissions: [...connectedCloudflare.permissions, originPermission] },
    ...overrides
  })
}

export const originCert = (kind: OriginCert['kind'] = 'cloudflare-origin'): OriginCert => makeOrigin({ kind, names: NAMES })

export function switchedReport(lineageDays = 10): SslReport {
  return readyReport({
    blocks: [makeBlock({ names: NAMES, certPath: CERT_PATH, keyPath: KEY_PATH })],
    hostnames: NAMES.map((name) => makeHost({ name, origin: originCert() })),
    lineages: [{
      name: 'app.example.com', domains: NAMES, notAfter: NOW + lineageDays * DAY,
      certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem', keyPath: '/etc/letsencrypt/live/app.example.com/privkey.pem'
    }]
  })
}

export interface Call {
  command: string
  stdin: string | undefined
}

export type Answer = { code: number; stdout?: string; output?: string } | Error

export function recorder(responder: (call: Call, attempt: number) => Answer | undefined) {
  const calls: Call[] = []
  const attempts = new Map<string, number>()
  const streamed: string[] = []
  const exec: RemoteExec = async (command, options) => {
    const stdin = typeof options?.stdin === 'string' ? options.stdin : undefined
    const call = { command, stdin }
    calls.push(call)
    const key = `${command}\u0000${stdin ?? ''}`
    const attempt = (attempts.get(key) ?? 0) + 1
    attempts.set(key, attempt)
    const answer = responder(call, attempt) ?? { code: 0 }
    if (answer instanceof Error) throw answer
    if (answer.output) options?.onOutput?.(answer.output)
    return { stdout: answer.stdout ?? '', stdoutBytes: 0, stderr: '', code: answer.code }
  }
  return { exec, calls, streamed, onOutput: (chunk: string) => streamed.push(chunk) }
}
