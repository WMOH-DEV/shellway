import { describe, expect, it } from 'vitest'
import { parsePm2 } from './pm2'

const ADMIN = { name: 'admin', id: 0, pid: 3100, cpu: 1.4, memory: 188743680, status: 'online', restarts: 2, uptime: 1_700_000_000_000, script: '/srv/admin/dist/server.js', instances: 1 }
const WORKER = { name: 'worker', id: 1, pid: 0, cpu: 0, memory: 0, status: 'errored', restarts: 15, uptime: 1_700_000_500_000, script: '/srv/admin/dist/worker.js', instances: 2 }

const OUTPUT = `@@now 1700000600
@@user deploy
@@startup
@@jlist
${JSON.stringify([ADMIN, WORKER])}
@@user app
@@stopped
`

describe('parsePm2', () => {
  it('parses users, startup state and projected apps', () => {
    const data = parsePm2(OUTPUT)
    if (!data.installed) throw new Error('expected pm2')
    expect(data.users).toEqual([
      {
        user: 'deploy',
        running: true,
        startup: true,
        apps: [
          { name: 'admin', id: 0, status: 'online', restarts: 2, cpuPercent: 1.4, memoryBytes: 188743680, sinceSeconds: 600, script: '/srv/admin/dist/server.js', instances: 1 },
          { name: 'worker', id: 1, status: 'errored', restarts: 15, cpuPercent: null, memoryBytes: null, sinceSeconds: 100, script: '/srv/admin/dist/worker.js', instances: 2 }
        ]
      },
      { user: 'app', running: false, startup: false, apps: [] }
    ])
  })

  it('ignores broken JSON', () => {
    const data = parsePm2('@@user deploy\n@@jlist\n[{"name":\n')
    expect(data).toEqual({ installed: true, users: [{ user: 'deploy', running: true, startup: false, apps: [] }] })
  })

  it('reports a missing pm2', () => {
    expect(parsePm2('@@missing\n')).toEqual({ installed: false })
  })

  it('returns no users when nothing was found', () => {
    expect(parsePm2('@@now 1700000600\n')).toEqual({ installed: true, users: [] })
  })
})
