import { describe, expect, it } from 'vitest'
import { fixture } from './testFixtures'
import { isConfigTestOk, parseModules, parseVhostDump } from './vhosts'

const SITES = '/etc/apache2/sites-enabled'

describe('parseVhostDump', () => {
  it('reads every vhost from recorded Debian apache2ctl -S output', () => {
    const dump = parseVhostDump(fixture('apache2ctl-S.txt'))
    expect(dump.entries).toEqual([
      { address: '127.0.0.1', port: 8443, name: 'api.example.net', aliases: [], file: `${SITES}/api.conf`, line: 8, isDefault: true },
      { address: '*', port: 443, name: 'shop.example.com', aliases: [], file: `${SITES}/shop.example.com-le-ssl.conf`, line: 2, isDefault: true },
      { address: '*', port: 80, name: '192.0.2.10', aliases: [], file: `${SITES}/000-default.conf`, line: 1, isDefault: true },
      { address: '*', port: 80, name: 'api.example.net', aliases: [], file: `${SITES}/api.conf`, line: 1, isDefault: false },
      { address: '*', port: 80, name: 'blog.example.org', aliases: [], file: `${SITES}/blog.example.org.conf`, line: 1, isDefault: false },
      { address: '*', port: 80, name: 'shop.example.com', aliases: ['www.shop.example.com'], file: `${SITES}/shop.example.com.conf`, line: 1, isDefault: false }
    ])
    expect(dump.files).toEqual([
      `${SITES}/api.conf`,
      `${SITES}/shop.example.com-le-ssl.conf`,
      `${SITES}/000-default.conf`,
      `${SITES}/blog.example.org.conf`,
      `${SITES}/shop.example.com.conf`
    ])
  })

  it('reads recorded RHEL httpd -S output and skips warnings and the run config', () => {
    const dump = parseVhostDump(fixture('rhel-httpd-S-M.txt'))
    expect(dump.entries.map(({ address, port, name, file, line }) => ({ address, port, name, file, line }))).toEqual([
      { address: '*', port: 80, name: 'shop.example.com', file: '/etc/httpd/conf.d/shop.example.com.conf', line: 1 },
      { address: '*', port: 443, name: '192.0.2.10', file: '/etc/httpd/conf.d/ssl.conf', line: 40 }
    ])
    expect(dump.files).toEqual(['/etc/httpd/conf.d/shop.example.com.conf', '/etc/httpd/conf.d/ssl.conf'])
  })

  it('reads any-port groups, IPv6 addresses and wild aliases', () => {
    const dump = parseVhostDump([
      'VirtualHost configuration:',
      '[2001:db8::1]:443      v6.example.com (/etc/apache2/sites-enabled/v6.conf:3)',
      '[::]:8080              any6.example.net (/etc/apache2/sites-enabled/any6.conf:1)',
      '*:*                    is a NameVirtualHost',
      '         default server any.example.com (/etc/apache2/sites-enabled/any.conf:1)',
      '         port * namevhost any.example.com (/etc/apache2/sites-enabled/any.conf:1)',
      '                 alias www.any.example.com',
      '                 wild alias *.any.example.com',
      '         port * namevhost other.example.org (/etc/apache2/sites-enabled/other.conf:4)',
      'ServerRoot: "/etc/apache2"',
      '                 alias stray.example.com'
    ].join('\r\n'))
    expect(dump.entries).toEqual([
      { address: '2001:db8::1', port: 443, name: 'v6.example.com', aliases: [], file: '/etc/apache2/sites-enabled/v6.conf', line: 3, isDefault: true },
      { address: '::', port: 8080, name: 'any6.example.net', aliases: [], file: '/etc/apache2/sites-enabled/any6.conf', line: 1, isDefault: true },
      { address: '*', port: 0, name: 'any.example.com', aliases: ['www.any.example.com', '*.any.example.com'], file: '/etc/apache2/sites-enabled/any.conf', line: 1, isDefault: true },
      { address: '*', port: 0, name: 'other.example.org', aliases: [], file: '/etc/apache2/sites-enabled/other.conf', line: 4, isDefault: false }
    ])
  })

  it('returns nothing for output without vhosts', () => {
    expect(parseVhostDump('AH00558: apache2: Could not reliably determine the server name\nVirtualHost configuration:\nServerRoot: "/etc/apache2"\n')).toEqual({ entries: [], files: [] })
  })
})

describe('parseModules', () => {
  it('reads module names without the _module suffix from recorded apache2ctl -M output', () => {
    const modules = parseModules(fixture('apache2ctl-M.txt'))
    expect(modules).toHaveLength(33)
    expect(modules.slice(0, 2)).toEqual(['core', 'so'])
    expect(modules).toEqual(expect.arrayContaining(['rewrite', 'proxy_fcgi', 'proxy_http', 'ssl', 'mpm_event']))
  })

  it('reads RHEL httpd -M output among unrelated lines', () => {
    expect(parseModules(fixture('rhel-httpd-S-M.txt'))).toEqual(['core'])
  })
})

describe('isConfigTestOk', () => {
  it.each([
    { code: 0, output: fixture('configtest-ok.txt'), ok: true },
    { code: 1, output: fixture('configtest-fail.txt'), ok: false },
    { code: 1, output: 'Syntax OK', ok: false },
    { code: null, output: 'Syntax OK', ok: false },
    { code: 0, output: 'apache2: Syntax error on line 3 of /etc/apache2/apache2.conf', ok: false }
  ])('exit $code is ok: $ok', ({ code, output, ok }) => {
    expect(isConfigTestOk(code, output)).toBe(ok)
  })
})
