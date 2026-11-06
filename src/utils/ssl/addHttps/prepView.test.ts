import { describe, expect, it } from 'vitest'
import { installPlan } from '../https/installPlan'
import { factViews, installOutcome, manualCommands, planTag } from './prepView'
import { ubuntuFacts } from './testFixtures'

describe('factViews', () => {
  it('reports a missing certbot as an error and the rest as found', () => {
    const views = factViews(ubuntuFacts)
    expect(views.map((v) => [v.label, v.value, v.tone])).toEqual([
      ['System', 'Ubuntu 24.04', 'success'],
      ['Web server', 'nginx', 'success'],
      ['certbot', 'not installed', 'error'],
      ['snapd', 'available', 'success'],
      ['sudo', 'passwordless', 'success']
    ])
  })

  it('warns when certbot lacks the plugin or sudo needs a password', () => {
    const views = factViews({ ...ubuntuFacts, certbot: { path: '/usr/bin/certbot', version: '2.9.0', method: 'apt' }, fullSudo: false, snapd: null })
    expect(views[2]).toMatchObject({ value: '2.9.0', sub: 'missing the nginx plugin', tone: 'warning' })
    expect(views[3]).toMatchObject({ value: 'not found', tone: 'neutral' })
    expect(views[4]).toMatchObject({ value: 'needs a password', tone: 'warning' })
  })
})

describe('planTag', () => {
  it('labels run, skip and check steps', () => {
    const plan = installPlan(ubuntuFacts, 'snap')
    const tags = Object.fromEntries(plan.steps.map((s) => [s.id, planTag(s)]))
    expect(tags['remove-packaged']).toBe('skipped · No packaged certbot found')
    expect(tags['install-snap']).toBe('will run')
    expect(tags['check-version']).toBe('check')
  })
})

describe('installOutcome', () => {
  it('reports success, a failed exit and a run that never started', () => {
    expect(installOutcome({ code: 0, output: '' }, null)).toEqual({ success: true, message: 'certbot installed' })
    expect(installOutcome({ code: 100, output: '' }, null)).toEqual({ success: false, message: 'The install failed (exit 100)' })
    expect(installOutcome(null, 'Another install is running')).toEqual({ success: false, message: 'The install could not run: Another install is running' })
  })
})

describe('manualCommands', () => {
  it('prefixes every command that is not skipped with sudo', () => {
    const commands = manualCommands(installPlan(ubuntuFacts, 'snap'))
    expect(commands[0]).toBe('sudo snap install --classic certbot')
    expect(commands.every((c) => c.startsWith('sudo '))).toBe(true)
    expect(commands.some((c) => c.includes('apt-get remove'))).toBe(false)
  })
})
