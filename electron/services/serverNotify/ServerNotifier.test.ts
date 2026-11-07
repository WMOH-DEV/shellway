import { describe, expect, it, vi } from 'vitest'
import type { DeployRecord } from '../../../src/types/deploy'
import type { ServerNotifications } from '../../../src/types/server/notifications'
import { ServerNotifier, type ServerNotifierDeps } from './ServerNotifier'

const ON: ServerNotifications = { kind: 'discord', url: 'https://discord.com/api/webhooks/1/x', events: ['deploy-failed', 'certificate-risk'] }

function setup(settings: ServerNotifications = ON, send = vi.fn<ServerNotifierDeps['send']>(async () => {})) {
  const onError = vi.fn()
  const notifier = new ServerNotifier({ settings: () => settings, send, onError })
  return { notifier, send, onError }
}

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
