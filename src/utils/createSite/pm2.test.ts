import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { pm2ActivateSteps, pm2SetupScript } from './pm2'

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
