import type { ServerFacts } from '../../../../types/server/core'
import { INVENTORY_PROBE } from '../inventory'
import type { SitesInventory } from '../types'

export const VHOST_PATH = '/etc/nginx/sites-enabled/app'
export const VHOST_REAL_PATH = '/etc/nginx/sites-available/app'

export const VHOST_CONTENT = [
  'server {',
  '    listen 443 ssl;',
  '    server_name app.example.com;',
  '    root /var/www/app/current/public;',
  '    location ~ \\.php$ { fastcgi_pass unix:/run/php/php8.3-fpm.sock; }',
  '}',
  ''
].join('\n')

export function makeInventory(overrides: Partial<SitesInventory> = {}): SitesInventory {
  return {
    user: 'deploy',
    fpmVersions: ['8.3', '8.4'],
    sites: [{ name: 'app', path: '/var/www/app', owner: 'deploy' }],
    vhosts: [{ path: VHOST_PATH, realPath: VHOST_REAL_PATH, sha256: 'a'.repeat(64), content: VHOST_CONTENT }],
    ...overrides
  }
}

export const factsWith = (inventory: SitesInventory): ServerFacts => ({ [INVENTORY_PROBE]: { status: 'ok', data: inventory, at: 1 } })
