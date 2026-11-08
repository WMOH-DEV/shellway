import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { TOOLS_SCRIPT, parseTools } from './serverTools'

describe('parseTools', () => {
  it('reads versions, yes/no tools and free disk', () => {
    const text = 'php=8.3\ncomposer=1\nnode=v20.11.1\npm2=0\ndocker=1\ndisk=1048576\n'
    expect(parseTools(text, ['rewrite'])).toEqual({ php: { installed: ['8.3'], installable: [], missingPackages: { '8.3': [] }, drivers: {} }, composer: true, node: '20', pm2: false, pm2Startup: false, docker: true, databases: { mysql: false, postgresql: false }, apacheModules: ['rewrite'], freeDiskBytes: 1073741824 })
  })

  it('reads whether pm2 starts on boot', () => {
    expect(parseTools('pm2=1\npm2_startup=1\n', []).pm2Startup).toBe(true)
  })

  it('treats missing or odd values as not installed', () => {
    expect(parseTools('php=\ncomposer=0\nnode=\ndisk=\n', [])).toMatchObject({ php: { installed: [], installable: [] }, composer: false, node: null, pm2: false, docker: false, freeDiskBytes: 0 })
    expect(parseTools('php=8.3; rm -rf /\n', []).php.installed).toEqual([])
  })

  it('lists installed PHP newest first, installable ones from 8.2 up, and missing packages per version', () => {
    const text = [
      'php= 8.3 8.4',
      'php_installable=8.1 5.6 7.4 8.0 8.2 8.3 8.4 8.5 8.6 ',
      'php_missing_8.3= php8.3-zip php9.9-evil',
      'php_missing_8.4='
    ].join('\n')
    expect(parseTools(text, []).php).toEqual({
      installed: ['8.4', '8.3'],
      installable: ['8.6', '8.5', '8.2'],
      missingPackages: { '8.4': [], '8.3': ['php8.3-zip'] }, drivers: {}
    })
  })
})

describe('parseTools databases', () => {
  it('reads which database servers are installed and which PHP drivers each version has', () => {
    const tools = parseTools('php=8.3 8.4\nphp_drivers_8.3= mysql sqlite3 evil\ndb_mysql=1\ndb_postgresql=0\n', [])
    expect(tools.databases).toEqual({ mysql: true, postgresql: false })
    expect(tools.php.drivers).toEqual({ '8.3': ['mysql', 'sqlite3'] })
  })
})

describe('TOOLS_SCRIPT', () => {
  it('is valid sh that prints every field', () => {
    const ran = spawnSync('sh', ['-s'], { input: TOOLS_SCRIPT, encoding: 'utf8' })
    expect(ran.status).toBe(0)
    for (const name of ['php', 'composer', 'node', 'pm2', 'pm2_startup', 'docker', 'db_mysql', 'db_postgresql', 'disk']) expect(ran.stdout).toMatch(new RegExp(`^${name}=`, 'm'))
  })
})
