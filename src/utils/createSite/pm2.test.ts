import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pm2ActivateSteps, pm2SetupScript, stopAppScript } from './pm2'

const syntaxOk = (script: string) => expect(spawnSync('sh', ['-n'], { input: script }).status).toBe(0)

describe('pm2SetupScript', () => {
  it('is valid sh with and without the install', () => {
    syntaxOk(pm2SetupScript('deploy', true))
    syntaxOk(pm2SetupScript('deploy', false))
  })

  it('stops with a clear message when root has no npm', () => {
    const result = spawnSync('/bin/sh', ['-s'], { input: pm2SetupScript('deploy', true), encoding: 'utf8', env: { PATH: '/nonexistent' } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('npm is not on the PATH for root')
  })

  it('refuses a user name that could break the script', () => {
    expect(() => pm2SetupScript("deploy'; reboot", true)).toThrow()
  })
})

describe('pm2ActivateSteps', () => {
  it('produces valid sh and refuses bad names, folders and ports', () => {
    for (const step of pm2ActivateSteps('shop', '/var/www/shop', 3000)) syntaxOk(step.command)
    expect(() => pm2ActivateSteps('shop;x', '/var/www/shop', 3000)).toThrow()
    expect(() => pm2ActivateSteps('shop', '/var/www/shop', 0)).toThrow()
  })
})

describe('stopAppScript', () => {
  let home = ''
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'stop-app-'))
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  const fake = (name: string, body: string) => {
    const path = join(home, '.local', 'bin', name)
    writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> '${home}/log'\n${body}\n`)
    chmodSync(path, 0o755)
  }
  const run = (script: string | null) => spawnSync('/bin/sh', ['-s'], { input: script ?? '', encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin' } })
  const log = () => (existsSync(join(home, 'log')) ? readFileSync(join(home, 'log'), 'utf8').trim().split('\n') : [])

  it('deletes the pm2 process and saves the list so it does not come back after a reboot', () => {
    fake('pm2', 'exit 0')
    expect(run(stopAppScript({ template: 'node', codeSource: 'git', siteName: 'shop' })).status).toBe(0)
    expect(log()).toEqual(['pm2 describe shop', 'pm2 delete shop', 'pm2 save --force'])
  })

  it('changes nothing when pm2 does not know the process', () => {
    fake('pm2', '[ "$1" = describe ] && exit 1; exit 0')
    expect(run(stopAppScript({ template: 'node', codeSource: 'git', siteName: 'shop' })).status).toBe(0)
    expect(log()).toEqual(['pm2 describe shop'])
  })

  it('takes a Compose project down without deleting its volumes', () => {
    fake('docker', 'exit 0')
    expect(run(stopAppScript({ template: 'compose', codeSource: 'git', siteName: 'shop' })).status).toBe(0)
    expect(log()).toEqual(['docker compose -p shop down'])
  })

  it('has nothing to stop for other stacks or a site without code', () => {
    expect(stopAppScript({ template: 'laravel', codeSource: 'git', siteName: 'shop' })).toBeNull()
    expect(stopAppScript({ template: 'node', codeSource: 'none', siteName: 'shop' })).toBeNull()
  })
})
