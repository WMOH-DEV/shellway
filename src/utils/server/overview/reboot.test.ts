import { describe, expect, it } from 'vitest'
import { REBOOT_PROBE, REBOOT_ROUTE } from './ids'
import { packageSummary, parseReboot, rebootAction, rebootAttention } from './reboot'

describe('parseReboot', () => {
  it('reads the flag and unique package names', () => {
    expect(parseReboot('required=1\npkg=linux-image-6.8.0-49-generic\npkg=libc6\npkg=libc6\n')).toEqual({ required: true, packages: ['linux-image-6.8.0-49-generic', 'libc6'] })
  })

  it('reports no reboot when the file is absent', () => {
    expect(parseReboot('required=0\n')).toEqual({ required: false, packages: [] })
  })
})

describe('packageSummary', () => {
  it.each([
    [[], 'An update asked for a restart.'],
    [['libc6'], 'Updates to libc6 take effect after a restart.'],
    [['a', 'b', 'c', 'd', 'e'], 'Updates to a, b, c and 2 more take effect after a restart.']
  ])('%j', (packages, text) => {
    expect(packageSummary(packages)).toBe(text)
  })
})

describe('rebootAttention', () => {
  it('adds a warning that opens the reboot plan', () => {
    const items = rebootAttention({ [REBOOT_PROBE]: { status: 'ok', data: { required: true, packages: [] }, at: 1 } })
    expect(items).toEqual([expect.objectContaining({ level: 'warning', title: 'Reboot required', actionLabel: 'Reboot', route: REBOOT_ROUTE })])
  })

  it('stays quiet when no reboot is needed or the probe is missing', () => {
    expect(rebootAttention({ [REBOOT_PROBE]: { status: 'ok', data: { required: false, packages: [] }, at: 1 } })).toEqual([])
    expect(rebootAttention({})).toEqual([])
  })
})

describe('rebootAction', () => {
  it('accepts no options only', () => {
    expect(rebootAction.validate(undefined)).toEqual({})
    expect(rebootAction.validate({})).toEqual({})
    expect(() => rebootAction.validate({ now: true })).toThrow()
    expect(() => rebootAction.validate('x')).toThrow()
  })

  it('plans one root step that schedules the reboot in the background and warns about downtime', () => {
    const plan = rebootAction.plan({}, {})
    expect(plan.blocked).toBeNull()
    expect(plan.steps).toHaveLength(1)
    const [step] = plan.steps
    expect(step.root).toBe(true)
    expect(step.display).toContain('systemctl reboot || shutdown -r now')
    expect(step.script).toContain("setsid nohup sh -c 'sleep 2; systemctl reboot || shutdown -r now' >/dev/null 2>&1 </dev/null &")
    expect(plan.warnings.join(' ')).toMatch(/reconnects/)
  })
})
