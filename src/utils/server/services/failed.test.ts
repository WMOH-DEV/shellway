import { describe, expect, it } from 'vitest'
import { parseFailed } from './failed'
import { parseUsage, sitesUsing } from './usage'

const FAILED = `@@unit redis-server.service
Nov 07 09:41:16 web redis-server[812]: Can't open the log file: Permission denied
Nov 07 09:41:16 web systemd[1]: redis-server.service: Failed with result 'exit-code'.
@@unit nginx.service
Nov 07 09:41:16 web nginx[900]: nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
@@nginx-test
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
@@program shop-queue:default_00
PHP Fatal error:  Uncaught Error: Class "Redis" not found
@@listen
LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("apache2",pid=700,fd=4))
LISTEN 0      4096       127.0.0.1:6379      0.0.0.0:*
`

describe('parseFailed', () => {
  it('groups journal lines per unit and program, keeps test output and listeners', () => {
    const data = parseFailed(FAILED)
    expect(Object.keys(data.units)).toEqual(['redis-server', 'nginx'])
    expect(data.units['redis-server']).toHaveLength(2)
    expect(data.programs['shop-queue:default_00']).toEqual(['PHP Fatal error:  Uncaught Error: Class "Redis" not found'])
    expect(data.nginxTest).toContain('test is successful')
    expect(data.apacheTest).toBeNull()
    expect(data.listeners).toEqual([
      { address: '0.0.0.0:80', port: 80, process: 'apache2' },
      { address: '127.0.0.1:6379', port: 6379, process: '' }
    ])
  })

  it('is empty when nothing failed', () => {
    expect(parseFailed('')).toEqual({ units: {}, programs: {}, nginxTest: null, apacheTest: null, listeners: [] })
  })
})

const USAGE = `@@nginx /etc/nginx/sites-enabled/shop
    server_name shop.example.com www.shop.example.com;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
@@nginx /etc/nginx/sites-enabled/default
    server_name _;
@@nginx /etc/nginx/sites-enabled/api
    server_name api.example.com;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
@@apache /etc/apache2/sites-enabled/legacy.conf
    ServerName legacy.example.com:80
    SetHandler "proxy:unix:/run/php/php8.2-fpm.sock|fcgi://localhost"
`

describe('parseUsage / sitesUsing', () => {
  const usage = parseUsage(USAGE)

  it('maps web servers and PHP versions to their sites', () => {
    expect(usage).toEqual({ nginx: ['shop.example.com', 'api.example.com'], apache: ['legacy.example.com'], php: { '8.3': ['shop.example.com', 'api.example.com'], '8.2': ['legacy.example.com'] } })
  })

  it.each([
    ['nginx', ['shop.example.com', 'api.example.com']],
    ['apache2', ['legacy.example.com']],
    ['php8.2-fpm', ['legacy.example.com']],
    ['php8.4-fpm', []],
    ['mysql', []]
  ])('%s is used by %j', (unit, expected) => {
    expect(sitesUsing(usage, unit)).toEqual(expected)
  })
})
