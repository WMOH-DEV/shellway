import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { RemoteExec } from '../../deploy/DeployService'
import { detectPrep, parsePrepFacts, PREP_SCRIPT } from './prepFacts'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('parsePrepFacts', () => {
  it('reads Ubuntu with a ready snap certbot', () => {
    expect(parsePrepFacts(fixture('prep-ubuntu-snap-ready.txt'))).toEqual({
      os: { id: 'ubuntu', versionId: '24.04', family: 'debian', pretty: 'Ubuntu 24.04 LTS' },
      arch: 'x86_64',
      webServer: 'nginx',
      certbot: { path: '/snap/bin/certbot', version: '2.11.0', method: 'snap' },
      plugins: ['apache', 'nginx', 'standalone'],
      snapd: '2.63',
      packageManager: 'apt',
      renewalTimer: 'snap.certbot.renew.timer',
      fullSudo: true
    })
  })

  it('reads Debian 12 without snapd or certbot', () => {
    expect(parsePrepFacts(fixture('prep-debian12-no-snapd.txt'))).toEqual({
      os: { id: 'debian', versionId: '12', family: 'debian', pretty: 'Debian GNU/Linux 12 (bookworm)' },
      arch: 'aarch64',
      webServer: 'nginx',
      certbot: null,
      plugins: [],
      snapd: null,
      packageManager: 'apt',
      renewalTimer: null,
      fullSudo: true
    })
  })

  it('reads Rocky 9 with Apache and an rpm certbot that lacks the plugin', () => {
    expect(parsePrepFacts(fixture('prep-rocky9-apache.txt'))).toEqual({
      os: { id: 'rocky', versionId: '9.4', family: 'rhel', pretty: 'Rocky Linux 9.4 (Blue Onyx)' },
      arch: 'x86_64',
      webServer: 'apache',
      certbot: { path: '/usr/bin/certbot', version: '2.6.0', method: 'dnf' },
      plugins: ['standalone'],
      snapd: null,
      packageManager: 'dnf',
      renewalTimer: null,
      fullSudo: true
    })
  })

  it('reads Alpine as another family with no package manager', () => {
    expect(parsePrepFacts(fixture('prep-alpine.txt'))).toMatchObject({
      os: { id: 'alpine', family: 'other', versionId: '3.19.1' },
      packageManager: null,
      webServer: 'nginx',
      fullSudo: false
    })
  })

  it('reads a server without sudo, prefers nginx over Apache and treats an unavailable snapd as none', () => {
    expect(parsePrepFacts(fixture('prep-ubuntu-no-sudo.txt'))).toMatchObject({
      webServer: 'nginx',
      certbot: { version: '1.21.0', method: 'apt' },
      plugins: ['nginx'],
      snapd: null,
      renewalTimer: 'certbot.timer',
      fullSudo: false
    })
  })

  it('falls back to Apache, then Caddy, then nothing', () => {
    const web = (body: string) => parsePrepFacts(`@@SW@@ WEB\n${body}\n`).webServer
    expect(web('nginx=\napache=/usr/sbin/httpd\ncaddy=/usr/bin/caddy')).toBe('apache')
    expect(web('nginx=\napache=\ncaddy=/usr/bin/caddy')).toBe('caddy')
    expect(web('nginx=\napache=\ncaddy=')).toBeNull()
  })

  it('recognises the pip install and a missing version', () => {
    const output = '@@SW@@ CERTBOT\npath=/opt/certbot/bin/certbot\n@@SW@@ METHOD\npip=1\n'
    expect(parsePrepFacts(output).certbot).toEqual({ path: '/opt/certbot/bin/certbot', version: '', method: 'pip' })
  })
})

describe('detectPrep', () => {
  it('runs one read-only script on stdin', async () => {
    const calls: { command: string; stdin: unknown }[] = []
    const exec: RemoteExec = async (command, options) => {
      calls.push({ command, stdin: options?.stdin })
      return { stdout: fixture('prep-alpine.txt'), stdoutBytes: 0, stderr: '', code: 0 }
    }
    await detectPrep(exec)
    expect(calls).toEqual([{ command: 'sh -s', stdin: PREP_SCRIPT }])
    expect(PREP_SCRIPT).not.toMatch(/sudo -n (?!true|-l|"\$certbot_path" plugins)/)
  })
})
