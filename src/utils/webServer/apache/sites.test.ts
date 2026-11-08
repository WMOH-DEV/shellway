import { describe, expect, it } from 'vitest'
import { parseApacheSites, vhostDetail } from './sites'
import { configDump, fixture } from './testFixtures'

const SITES = '/etc/apache2/sites-enabled'

const recordedDump = () => configDump({
  [`${SITES}/000-default.conf`]: fixture('vhost-000-default.conf'),
  [`${SITES}/api.conf`]: fixture('vhost-api.conf'),
  [`${SITES}/blog.example.org.conf`]: fixture('vhost-blog.example.org.conf'),
  [`${SITES}/shop.example.com.conf`]: fixture('vhost-shop.example.com.conf'),
  [`${SITES}/shop.example.com-le-ssl.conf`]: fixture('vhost-shop.example.com-le-ssl.conf')
})

const sitesOf = (text: string) => parseApacheSites(configDump({ '/etc/apache2/sites-enabled/test.conf': text }))

describe('parseApacheSites', () => {
  it('reads one site per VirtualHost from the recorded Debian files', () => {
    expect(parseApacheSites(recordedDump())).toEqual([
      { id: `${SITES}/000-default.conf:1`, file: `${SITES}/000-default.conf`, line: 1, names: [], tls: false, certPath: '', keyPath: '', probeAddress: '127.0.0.1:443', root: '/var/www/html' },
      { id: `${SITES}/api.conf:1`, file: `${SITES}/api.conf`, line: 1, names: ['api.example.net'], tls: false, certPath: '', keyPath: '', probeAddress: '127.0.0.1:443', root: null },
      {
        id: `${SITES}/api.conf:8`,
        file: `${SITES}/api.conf`,
        line: 8,
        names: ['api.example.net'],
        tls: true,
        certPath: '/etc/letsencrypt/live/api.example.net/fullchain.pem',
        keyPath: '/etc/letsencrypt/live/api.example.net/privkey.pem',
        probeAddress: '127.0.0.1:8443',
        root: null
      },
      { id: `${SITES}/blog.example.org.conf:1`, file: `${SITES}/blog.example.org.conf`, line: 1, names: ['blog.example.org'], tls: false, certPath: '', keyPath: '', probeAddress: '127.0.0.1:443', root: '/var/www/blog' },
      {
        id: `${SITES}/shop.example.com.conf:1`,
        file: `${SITES}/shop.example.com.conf`,
        line: 1,
        names: ['shop.example.com', 'www.shop.example.com'],
        tls: false,
        certPath: '',
        keyPath: '',
        probeAddress: '127.0.0.1:443',
        root: '/var/www/shop/current/public'
      },
      {
        id: `${SITES}/shop.example.com-le-ssl.conf:2`,
        file: `${SITES}/shop.example.com-le-ssl.conf`,
        line: 2,
        names: ['shop.example.com', 'www.shop.example.com'],
        tls: true,
        certPath: '/etc/letsencrypt/live/shop.example.com/fullchain.pem',
        keyPath: '/etc/letsencrypt/live/shop.example.com/privkey.pem',
        probeAddress: '127.0.0.1:443',
        root: '/var/www/shop/current/public'
      }
    ])
  })

  it.each([
    { addresses: '*:80', tls: false, probe: '127.0.0.1:443' },
    { addresses: '_default_:443', tls: true, probe: '127.0.0.1:443' },
    { addresses: '192.0.2.20:80 192.0.2.20:443', tls: true, probe: '192.0.2.20:443' },
    { addresses: '*:443 192.0.2.21:443', tls: true, probe: '192.0.2.21:443' },
    { addresses: '[2001:db8::5]:443', tls: true, probe: '[2001:db8::5]:443' },
    { addresses: '[::]:443', tls: true, probe: '127.0.0.1:443' },
    { addresses: '*', tls: false, probe: '127.0.0.1:443' }
  ])('probes <VirtualHost $addresses> at $probe', ({ addresses, tls, probe }) => {
    const [site] = sitesOf(`<VirtualHost ${addresses}>\n    ServerName app.example.com\n</VirtualHost>\n`)
    expect(site).toMatchObject({ tls, probeAddress: probe })
  })

  it('treats SSLEngine on as TLS and probes its own port', () => {
    const [site] = sitesOf('<VirtualHost 192.0.2.30:8443>\n    ServerName alt.example.com\n    SSLEngine On\n</VirtualHost>\n')
    expect(site).toMatchObject({ tls: true, certPath: '', probeAddress: '192.0.2.30:8443' })
  })

  it('reads two VirtualHosts in one file inside an IfModule wrapper', () => {
    const sites = sitesOf([
      '<IfModule mod_ssl.c>',
      '<VirtualHost *:80>',
      '    ServerName one.example.com',
      '</VirtualHost>',
      '',
      '<VirtualHost *:443>',
      '    ServerName two.example.com',
      '    SSLCertificateFile /etc/ssl/two.pem',
      '    SSLCertificateKeyFile /etc/ssl/two.key',
      '</VirtualHost>',
      '</IfModule>'
    ].join('\n'))
    expect(sites.map(({ line, names, tls, certPath }) => ({ line, names, tls, certPath }))).toEqual([
      { line: 2, names: ['one.example.com'], tls: false, certPath: '' },
      { line: 6, names: ['two.example.com'], tls: true, certPath: '/etc/ssl/two.pem' }
    ])
  })

  it('reads directives in any case, quoted values, continuations and wildcard aliases, and skips comments and Include lines', () => {
    const [site] = sitesOf([
      '<virtualhost *:443>',
      '\t# ServerName commented.example.com',
      '\tservername https://App.Example.com:443',
      '\tSERVERALIAS app.example.com \\',
      '\t    www.app.example.com *.app.example.com',
      '\tDocumentRoot "/srv/www/app site"',
      '\tInclude /etc/apache2/snippets/app.conf',
      '\tsslcertificatefile "/etc/ssl/app.pem"',
      '\tSslCertificateKeyFile \'/etc/ssl/app.key\'',
      '</virtualhost>'
    ].join('\r\n'))
    expect(site).toMatchObject({
      line: 1,
      names: ['App.Example.com', 'app.example.com', 'www.app.example.com', '*.app.example.com'],
      root: '/srv/www/app site',
      certPath: '/etc/ssl/app.pem',
      keyPath: '/etc/ssl/app.key'
    })
  })

  it('keeps line numbers right after a continuation line', () => {
    const sites = sitesOf('<VirtualHost *:80>\n    ServerAlias a.example.com \\\n        b.example.com\n</VirtualHost>\n<VirtualHost *:80>\n    ServerName c.example.com\n</VirtualHost>\n')
    expect(sites.map((s) => s.line)).toEqual([1, 5])
  })

  it('finds nothing in a file without VirtualHost blocks', () => {
    expect(parseApacheSites(configDump({ '/etc/apache2/ports.conf': fixture('ports.conf') }))).toEqual([])
  })
})

describe('vhostDetail', () => {
  it('reads the docroot, directories and PHP-FPM socket of the recorded -le-ssl.conf site', () => {
    expect(vhostDetail(fixture('vhost-shop.example.com-le-ssl.conf'), 2)).toEqual({
      documentRoot: '/var/www/shop/current/public',
      directories: [{ path: '/var/www/shop/current/public', options: ['FollowSymLinks'], allowOverride: ['All'] }],
      phpHandler: '/run/php/php8.2-fpm.sock',
      rewriteEngine: false,
      includes: ['/etc/letsencrypt/options-ssl-apache.conf']
    })
  })

  it('sees the rewrite engine certbot turned on in the recorded :80 site', () => {
    expect(vhostDetail(fixture('vhost-shop.example.com.conf'), 1)).toMatchObject({ rewriteEngine: true, includes: [] })
  })

  it('reads a site without PHP from the recorded blog file', () => {
    expect(vhostDetail(fixture('vhost-blog.example.org.conf'), 1)).toEqual({
      documentRoot: '/var/www/blog',
      directories: [{ path: '/var/www/blog', options: ['Indexes'], allowOverride: ['None'] }],
      phpHandler: null,
      rewriteEngine: false,
      includes: []
    })
  })

  it.each([
    { body: '<IfModule mod_php7.c>\n    php_value upload_max_filesize 64M\n</IfModule>', handler: 'mod_php' },
    { body: '<IfModule php_module>\n    DirectoryIndex index.php\n</IfModule>', handler: 'mod_php' },
    { body: '<Directory /var/www/app>\n    php_admin_flag engine on\n</Directory>', handler: 'mod_php' },
    { body: '<IfModule !mod_php.c>\n    DirectoryIndex index.html\n</IfModule>', handler: null },
    { body: 'SetHandler "proxy:fcgi://127.0.0.1:9000"', handler: null },
    { body: '<FilesMatch \\.php$>\n    SetHandler "proxy:unix:/run/php/php8.3-fpm.sock|fcgi://localhost"\n</FilesMatch>', handler: '/run/php/php8.3-fpm.sock' }
  ])('finds the PHP handler $handler', ({ body, handler }) => {
    expect(vhostDetail(`<VirtualHost *:80>\n${body}\n</VirtualHost>\n`, 1).phpHandler).toBe(handler)
  })

  it('collects Options and AllowOverride per Directory and Include and IncludeOptional in file order', () => {
    const detail = vhostDetail([
      '<VirtualHost *:80>',
      '    IncludeOptional /etc/apache2/app.d/*.conf',
      '    <Directory /var/www/app/current/public>',
      '        Options -Indexes +FollowSymLinks',
      '        AllowOverride FileInfo AuthConfig',
      '    </Directory>',
      '    <Directory /var/www/app/storage>',
      '        Options None',
      '    </Directory>',
      '    Include /etc/apache2/app-extra.conf',
      '</VirtualHost>'
    ].join('\n'), 1)
    expect(detail.directories).toEqual([
      { path: '/var/www/app/current/public', options: ['-Indexes', '+FollowSymLinks'], allowOverride: ['FileInfo', 'AuthConfig'] },
      { path: '/var/www/app/storage', options: ['None'], allowOverride: [] }
    ])
    expect(detail.includes).toEqual(['/etc/apache2/app.d/*.conf', '/etc/apache2/app-extra.conf'])
  })

  it('refuses a line that does not start a VirtualHost', () => {
    expect(() => vhostDetail(fixture('vhost-blog.example.org.conf'), 2)).toThrow(/line 2 was not found/)
  })
})
