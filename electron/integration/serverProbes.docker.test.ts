import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ALL_PROBES } from '../../src/utils/server/areas'

const DOCKER = process.env.SHELLWAY_DOCKER_BIN ?? 'docker'
const ENABLED = process.env.SHELLWAY_DOCKER_IT === '1'
const BOXES = (process.env.SHELLWAY_IT_SERVERS ?? 'shellway-it-ubuntu,shellway-it-debian').split(',')
const SSH_CONNECTION = '203.0.113.5 50000 172.17.0.2 22'

function runProbe(box: string, script: string, root: boolean, timeoutSeconds: number) {
  const command = [...(root ? ['sudo', '-n'] : []), 'timeout', '-k', '5', String(timeoutSeconds), 'sh', '-s']
  const result = spawnSync(DOCKER, ['exec', '-i', '-u', 'deploy', '-w', '/home/deploy', '-e', `SSH_CONNECTION=${SSH_CONNECTION}`, '-e', 'HOME=/home/deploy', '-e', 'USER=deploy', box, ...command], { input: script, encoding: 'utf8', timeout: (timeoutSeconds + 10) * 1000 })
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe.skipIf(!ENABLED).each(BOXES)('probes on %s', (box) => {
  it.each(ALL_PROBES.map((probe) => [probe.id, probe] as const))('%s runs and parses', (_id, probe) => {
    const result = runProbe(box, probe.script, probe.root, probe.timeoutSeconds)
    expect(result.code, result.stderr).toBe(0)
    expect(() => probe.parse(result.stdout)).not.toThrow()
    if (process.env.SHELLWAY_IT_DUMP === '1') console.log(`@@ ${box} ${probe.id}\n${JSON.stringify(probe.parse(result.stdout))}`)
  })
})
