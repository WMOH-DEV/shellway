import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { TOOLS_SCRIPT, parseTools } from './serverTools'

describe('parseTools', () => {
  it('reads versions, yes/no tools and free disk', () => {
    const text = 'php=8.3\ncomposer=1\nnode=v20.11.1\npm2=0\ndocker=1\ndisk=1048576\n'
    expect(parseTools(text, ['rewrite'])).toEqual({ phpFpm: '8.3', composer: true, node: '20', pm2: false, docker: true, apacheModules: ['rewrite'], freeDiskBytes: 1073741824 })
  })

  it('treats missing or odd values as not installed', () => {
    expect(parseTools('php=\ncomposer=0\nnode=\ndisk=\n', [])).toMatchObject({ phpFpm: null, composer: false, node: null, pm2: false, docker: false, freeDiskBytes: 0 })
    expect(parseTools('php=8.3; rm -rf /\n', []).phpFpm).toBeNull()
  })
})

describe('TOOLS_SCRIPT', () => {
  it('is valid sh that prints every field', () => {
    const ran = spawnSync('sh', ['-s'], { input: TOOLS_SCRIPT, encoding: 'utf8' })
    expect(ran.status).toBe(0)
    for (const name of ['php', 'composer', 'node', 'pm2', 'docker', 'disk']) expect(ran.stdout).toMatch(new RegExp(`^${name}=`, 'm'))
  })
})
