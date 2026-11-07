import { describe, expect, it } from 'vitest'
import { parseContainers, parseSize } from './containers'

const ps = (row: Record<string, string>) => JSON.stringify(row)

const OUTPUT = `@@access sudo
@@ps
${ps({ ID: 'a1b2c3d4e5f6a7b8', Names: 'status-app', Image: 'acme/status-page:1.4', State: 'running', Status: 'Up 5 days', Labels: 'com.docker.compose.project=status,com.docker.compose.service=web' })}
${ps({ ID: 'ffeeddccbbaa0099', Names: 'old-job', Image: 'acme/job:2', Status: 'Exited (1) 2 hours ago', Labels: '' })}
not json
@@restart
/status-app unless-stopped
/old-job no
@@stats
${ps({ Name: 'status-app', CPUPerc: '0.80%', MemUsage: '120MiB / 7.6GiB' })}
`

describe('parseContainers', () => {
  it('merges ps, restart policy and stats', () => {
    expect(parseContainers(OUTPUT)).toEqual({
      installed: true,
      access: 'sudo',
      containers: [
        { id: 'a1b2c3d4e5f6', name: 'status-app', image: 'acme/status-page:1.4', state: 'running', status: 'Up 5 days', project: 'status', restartPolicy: 'unless-stopped', cpuPercent: 0.8, memoryBytes: 120 * 1024 ** 2 },
        { id: 'ffeeddccbbaa', name: 'old-job', image: 'acme/job:2', state: 'exited', status: 'Exited (1) 2 hours ago', project: '', restartPolicy: 'no', cpuPercent: null, memoryBytes: null }
      ]
    })
  })

  it('reports no access and a missing docker', () => {
    expect(parseContainers('@@denied\n')).toEqual({ installed: true, access: null, containers: [] })
    expect(parseContainers('@@missing\n')).toEqual({ installed: false })
  })
})

describe('parseSize', () => {
  it.each([['120MiB', 125829120], ['1.5GiB', 1610612736], ['512kB', 512000], ['0B', 0], ['n/a', null]])('%s -> %s', (text, expected) => {
    expect(parseSize(text)).toBe(expected)
  })
})
