import { describe, expect, it } from 'vitest'
import type { MonitorSnapshot } from '@/types/monitor'
import type { ServerIdentity } from '@/types/server/identity'
import { infoCopyText, serverInfoRows, type InfoInput } from './serverInfo'

const GB = 1024 ** 3

const identity: ServerIdentity = {
  hostname: 'test-server',
  os: { family: 'ubuntu', id: 'ubuntu', versionId: '24.04', codename: 'noble', prettyName: 'Ubuntu 24.04.1 LTS' },
  kernel: '6.8.0-48-generic',
  arch: 'x86_64',
  virtualization: 'kvm',
  cpus: 4,
  memoryBytes: 8 * GB,
  uptimeSeconds: 3600,
  primaryIp: '203.0.113.10',
  sshPort: 22,
  user: 'deploy',
  timezone: 'UTC'
}

const snapshot = { hostname: 'snap-host', os: 'Debian 12', kernel: '6.1.0', cpuCount: 2, cpuModel: 'AMD EPYC', memTotalBytes: 2 * GB, swapTotalBytes: GB, uptime: 25 * 86400 + 10 * 3600 } as MonitorSnapshot

const input = (overrides: Partial<InfoInput>): InfoInput => ({
  identity: null,
  snapshot: null,
  system: null,
  rootFs: null,
  session: { host: 'app.example.com', port: 2222, username: 'root' },
  connection: { status: 'connected', latencyMs: 32 },
  ...overrides
})

const asMap = (rows: ReturnType<typeof serverInfoRows>) => Object.fromEntries(rows.map((r) => [r.label, r.value]))

describe('serverInfoRows', () => {
  it('prefers identity facts and fills CPU model, swap and uptime from the live monitor', () => {
    const rows = asMap(serverInfoRows(input({ identity, snapshot, rootFs: { device: '/dev/vda1', type: 'ext4', sizeBytes: 80 * GB, usedBytes: 0, availBytes: 0, usedPercent: 0, mount: '/' } })))
    expect(rows).toMatchObject({
      Hostname: 'test-server',
      Address: 'app.example.com',
      'Server IP': '203.0.113.10',
      'SSH user': 'deploy · port 22',
      OS: 'Ubuntu 24.04.1 LTS',
      Kernel: '6.8.0-48-generic',
      Architecture: 'x86_64',
      Virtualization: 'kvm',
      CPU: '4 vCPU · AMD EPYC',
      Memory: '8 GB · swap 1 GB',
      Disk: '80 GB on /',
      Timezone: 'UTC',
      Uptime: '25 d 10 h',
      Connection: 'connected · 32 ms'
    })
  })

  it('falls back to the monitor and the saved session without identity, hiding unknown rows', () => {
    const rows = asMap(serverInfoRows(input({ snapshot })))
    expect(rows).toMatchObject({ Hostname: 'snap-host', OS: 'Debian 12', 'SSH user': 'root · port 2222', CPU: '2 vCPU · AMD EPYC' })
    expect(rows).not.toHaveProperty('Architecture')
    expect(rows).not.toHaveProperty('Timezone')
  })

  it('shows only the connection when nothing is known yet', () => {
    expect(serverInfoRows(input({ session: null, connection: { status: 'connecting', latencyMs: null } }))).toEqual([{ label: 'Connection', value: 'connecting', mono: false }])
  })
})

describe('infoCopyText', () => {
  it('writes one label: value line per row', () => {
    expect(infoCopyText([{ label: 'Hostname', value: 'test-server', mono: true }, { label: 'OS', value: 'Ubuntu', mono: false }])).toBe('Hostname: test-server\nOS: Ubuntu')
  })
})
