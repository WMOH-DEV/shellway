import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerBlock } from '../../../src/types/ssl'
import { makeBlock, makeFacts } from '../../../src/utils/ssl/testReport'
import type { RemoteExec } from './DeployService'
import { readWebServerCheck } from './webServerCheck'

const config = vi.hoisted(() => ({ value: null as unknown }))

vi.mock('../ssl/SslService', () => ({
  SslService: class {
    readConfig = async () => config.value
  }
}))

const SSL_FILE = '/etc/apache2/sites-enabled/app-le-ssl.conf'
const PLAIN_FILE = '/etc/apache2/sites-enabled/app.conf'

const SSL_SITE = `<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName app.example.com
    DocumentRoot /var/www/app/public
    <Directory /var/www/app/public>
        Options FollowSymLinks
        AllowOverride All
    </Directory>
</VirtualHost>
</IfModule>
`

const apacheFacts = makeFacts({ nginx: null, apache: { version: '2.4.62', layout: 'debian' }, serving: 'apache', paths: { certbot: null, nginx: null, apache: '/usr/sbin/apache2ctl' }, sudo: { certbot: false, nginx: false, apache: true, full: true, installed: true } })

function blocks(): ServerBlock[] {
  return [
    makeBlock({ id: `${PLAIN_FILE}:1`, file: PLAIN_FILE, line: 1, tls: false, root: '/var/www/app/public' }),
    makeBlock({ id: `${SSL_FILE}:2`, file: SSL_FILE, line: 2, tls: true, root: '/var/www/app/public' }),
    makeBlock({ id: '/etc/apache2/sites-enabled/other.conf:1', file: '/etc/apache2/sites-enabled/other.conf', root: '/var/www/application' })
  ]
}

let commands: string[]
let modules: { code: number; stdout: string }

const exec: RemoteExec = async (command) => ({ stdoutBytes: 0, ...answer(command) })

function answer(command: string): { code: number; stdout: string; stderr: string } {
  commands.push(command)
  if (command === `sudo -n cat -- '${SSL_FILE}'`) return { code: 0, stdout: SSL_SITE, stderr: '' }
  if (command === `sudo -n cat -- '${PLAIN_FILE}'`) return { code: 1, stdout: '', stderr: 'denied' }
  if (command === "sudo -n '/usr/sbin/apache2ctl' -M") return { ...modules, stderr: '' }
  return { code: 1, stdout: '', stderr: 'unexpected' }
}

beforeEach(() => {
  commands = []
  modules = { code: 0, stdout: 'Loaded Modules:\n core_module (static)\n rewrite_module (shared)\n' }
  config.value = { facts: apacheFacts, blocks: blocks() }
})

describe('readWebServerCheck', () => {
  it('reads only the Apache sites inside the folder, HTTPS first, and skips files it cannot read', async () => {
    const check = await readWebServerCheck(exec, '/var/www/app')
    expect(check).toMatchObject({ server: 'apache', layout: 'debian', rewriteModule: true })
    expect(check.sites.map((site) => site.file)).toEqual([SSL_FILE])
    expect(check.sites[0].detail).toMatchObject({ documentRoot: '/var/www/app/public', directories: [{ path: '/var/www/app/public', options: ['FollowSymLinks'], allowOverride: ['All'] }] })
    expect(commands.some((command) => command.includes('other.conf'))).toBe(false)
  })

  it('reports mod_rewrite as missing or unknown', async () => {
    modules = { code: 0, stdout: 'Loaded Modules:\n core_module (static)\n' }
    expect((await readWebServerCheck(exec, '/var/www/app')).rewriteModule).toBe(false)
    modules = { code: 1, stdout: '' }
    expect((await readWebServerCheck(exec, '/var/www/app')).rewriteModule).toBeNull()
  })

  it('runs nothing more when nginx serves the server', async () => {
    config.value = { facts: makeFacts(), blocks: blocks() }
    expect(await readWebServerCheck(exec, '/var/www/app')).toMatchObject({ server: 'nginx', sites: [], rewriteModule: null })
    expect(commands).toEqual([])
  })
})
