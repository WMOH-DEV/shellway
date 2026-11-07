import { describe, expect, it, vi } from 'vitest'
import type { DeployRecord } from '../../../src/types/deploy'
import type { ProbeResult } from '../../../src/types/server/core'
import { IDENTITY_PROBE } from '../../../src/types/server/identity'
import type { ServerNotifications } from '../../../src/types/server/notifications'
import { REBOOT_PROBE } from '../../../src/utils/server/overview/ids'
import { PROBE } from '../../../src/utils/server/services/probes'
import { ServerNotifier, type ServerNotifierDeps } from './ServerNotifier'

const ON: ServerNotifications = { kind: 'discord', url: 'https://discord.com/api/webhooks/1/x', events: ['deploy-failed', 'certificate-risk'] }
const ALL: ServerNotifications = { ...ON, events: [...ON.events, 'service-down', 'reboot-required'] }

function setup(settings: ServerNotifications = ON, send = vi.fn<ServerNotifierDeps['send']>(async () => {})) {
  const onError = vi.fn()
  const notifier = new ServerNotifier({ settings: () => settings, send, onError })
  return { notifier, send, onError }
}

const ok = (data: unknown): ProbeResult => ({ status: 'ok', data, at: 1 })
const reboot = (required: boolean): ProbeResult => ok({ required, packages: [] })
const identity = (hostname: string): ProbeResult => ok({ hostname })
const unit = (name: string, active: string) => ({ name, description: '', load: 'loaded', active, sub: active, enabled: true, cpuPercent: null, memoryBytes: null, sinceSeconds: null })
const systemd = (...units: ReturnType<typeof unit>[]): ProbeResult => ok({ installed: true, units })

function record(status: DeployRecord['status'], note = ''): DeployRecord {
  return { id: 'd1', status, trigger: 'manual', commit: 'abc1234', started: 1, finished: 2, warnings: 0, note, subject: '' }
}

describe('ServerNotifier', () => {
  it('sends failed and reverted deploys, not successful ones', () => {
    const { notifier, send } = setup()
    notifier.observe('deploy:finished', ['c1', 'app.example.com', record('success')])
    notifier.observe('deploy:finished', ['c1', 'app.example.com', record('failed', 'composer install exit 1')])
    notifier.observe('deploy:finished', ['c1', 'app.example.com', record('reverted')])
    expect(send.mock.calls).toEqual([
      [{ kind: 'discord', url: ON.url }, 'deploy-failed', 'Shellway: deploy of app.example.com failed: composer install exit 1'],
      [{ kind: 'discord', url: ON.url }, 'deploy-failed', 'Shellway: deploy of app.example.com failed']
    ])
  })

  it('sends certificate risk only when the critical count goes up, per connection', () => {
    const { notifier, send } = setup()
    for (const [connection, count] of [['c1', 0], ['c1', 2], ['c1', 2], ['c1', 1], ['c1', 3], ['c2', 1]] as const) {
      notifier.observe('ssl:critical', [connection, count])
    }
    expect(send.mock.calls.map((call) => call[2])).toEqual([
      'Shellway: 2 certificates need attention',
      'Shellway: 3 certificates need attention',
      'Shellway: 1 certificate needs attention'
    ])
  })

  it('sends reboot-required once per need, naming the host', () => {
    const { notifier, send } = setup(ALL)
    const facts = { [IDENTITY_PROBE]: identity('web-1') }
    notifier.observe('server:facts', ['c1', { ...facts, [REBOOT_PROBE]: reboot(true) }])
    notifier.observe('server:facts', ['c1', { ...facts, [REBOOT_PROBE]: reboot(true) }])
    notifier.observe('server:facts', ['c1', { ...facts, [REBOOT_PROBE]: reboot(false) }])
    notifier.observe('server:facts', ['c1', { ...facts, [REBOOT_PROBE]: reboot(true) }])
    expect(send.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['reboot-required', 'Shellway: web-1 needs a reboot to finish installing updates.'],
      ['reboot-required', 'Shellway: web-1 needs a reboot to finish installing updates.']
    ])
  })

  it('stays quiet when no reboot is needed and falls back to the connection id without a hostname', () => {
    const { notifier, send } = setup(ALL)
    notifier.observe('server:facts', ['c1', { [REBOOT_PROBE]: reboot(false) }])
    expect(send).not.toHaveBeenCalled()
    notifier.observe('server:facts', ['c9', { [REBOOT_PROBE]: reboot(true) }])
    expect(send.mock.calls[0][2]).toBe('Shellway: c9 needs a reboot to finish installing updates.')
  })

  it('sends service-down only for newly failed services, and again after a recovery', () => {
    const { notifier, send } = setup(ALL)
    const facts = (...units: ReturnType<typeof unit>[]) => ({ [IDENTITY_PROBE]: identity('web-1'), [PROBE.systemd]: systemd(...units) })
    notifier.observe('server:facts', ['c1', facts(unit('nginx', 'active'))])
    notifier.observe('server:facts', ['c1', facts(unit('nginx', 'failed'))])
    notifier.observe('server:facts', ['c1', facts(unit('nginx', 'failed'))])
    notifier.observe('server:facts', ['c1', facts(unit('nginx', 'active'))])
    notifier.observe('server:facts', ['c1', facts(unit('nginx', 'failed'), unit('redis', 'failed'))])
    expect(send.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['service-down', 'Shellway: nginx stopped on web-1.'],
      ['service-down', 'Shellway: nginx, redis stopped on web-1.']
    ])
  })

  it('keeps service state when a scan lacks the services probe or the probe is not ok', () => {
    const { notifier, send } = setup(ALL)
    const failed = { [PROBE.systemd]: systemd(unit('nginx', 'failed')) }
    notifier.observe('server:facts', ['c1', failed])
    notifier.observe('server:facts', ['c1', { [REBOOT_PROBE]: reboot(false) }])
    notifier.observe('server:facts', ['c1', { [PROBE.systemd]: { status: 'error', error: 'timeout', at: 2 } }])
    notifier.observe('server:facts', ['c1', failed])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('ignores a reboot probe that is not ok and tracks connections separately', () => {
    const { notifier, send } = setup(ALL)
    notifier.observe('server:facts', ['c1', { [REBOOT_PROBE]: { status: 'unavailable', reason: 'none', at: 1 } }])
    expect(send).not.toHaveBeenCalled()
    notifier.observe('server:facts', ['c1', { [PROBE.systemd]: systemd(unit('nginx', 'failed')) }])
    notifier.observe('server:facts', ['c2', { [PROBE.systemd]: systemd(unit('nginx', 'failed')) }])
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('stays quiet when off or when the event is not chosen', () => {
    const off = setup({ ...ON, kind: 'off' })
    off.notifier.notify('deploy-failed', 'x')
    const unchosen = setup()
    unchosen.notifier.notify('service-down', 'x')
    expect(off.send).not.toHaveBeenCalled()
    expect(unchosen.send).not.toHaveBeenCalled()
  })

  it('ignores other channels and malformed arguments', () => {
    const { notifier, send } = setup()
    notifier.observe('deploy:changed', ['c1'])
    notifier.observe('deploy:finished', ['c1', 'app', null])
    notifier.observe('ssl:critical', ['c1', '3'])
    expect(send).not.toHaveBeenCalled()
  })

  it('reports a failed send without throwing', async () => {
    const { notifier, onError } = setup(ON, vi.fn<ServerNotifierDeps['send']>(async () => { throw new Error('Could not reach the discord address') }))
    notifier.notify('deploy-failed', 'x')
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Could not reach the discord address'))
  })
})
