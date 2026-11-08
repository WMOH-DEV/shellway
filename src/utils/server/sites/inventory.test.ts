import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { inventoryProbe, parseInventory } from './inventory'

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')
const SHA = 'c'.repeat(64)

describe('sites.inventory probe', () => {
  it('is valid shell', () => {
    expect(() => execFileSync('sh', ['-n'], { input: inventoryProbe.script })).not.toThrow()
  })

  it('parses user, FPM versions, deploy sites and site files', () => {
    const stdout = [
      '@@user deploy',
      '@@fpm 8.3',
      '@@fpm 8.4',
      '@@fpm junk',
      '@@site app\tdeploy\t/var/www/app',
      `@@vhost ${SHA}\t/etc/nginx/sites-enabled/app\t/etc/nginx/sites-available/app`,
      b64('server_name app.example.com; # café\n'),
      `@@vhost ${SHA}\t/etc/nginx/sites-enabled/app\t/etc/nginx/sites-available/app`,
      b64('duplicate'),
      ''
    ].join('\n')
    expect(parseInventory(stdout)).toEqual({
      user: 'deploy',
      fpmVersions: ['8.3', '8.4'],
      sites: [{ name: 'app', owner: 'deploy', path: '/var/www/app' }],
      vhosts: [{ sha256: SHA, path: '/etc/nginx/sites-enabled/app', realPath: '/etc/nginx/sites-available/app', content: 'server_name app.example.com; # café\n' }]
    })
  })

  it('returns empty lists on a server without sites', () => {
    expect(parseInventory('@@user root\n')).toEqual({ user: 'root', fpmVersions: [], sites: [], vhosts: [] })
  })
})
