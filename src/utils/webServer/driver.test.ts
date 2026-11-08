import { describe, expect, it } from 'vitest'
import { apacheDriver } from './apache'
import type { WebServerDriver } from './driver'
import { makeFacts } from '../ssl/testReport'
import { servingDriver, webServerDriver } from './index'

interface DriverCase {
  driver: WebServerDriver
  file: string
  blockLine: number
  names: string[]
  certPath: string
  keyPath: string
  keptLines: string[]
}

const NGINX_SITE = `server {
    server_name app.example.com www.app.example.com;
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
`

const APACHE_SITE = `<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName app.example.com
    ServerAlias www.app.example.com
    DocumentRoot /var/www/app/current/public

SSLCertificateFile /etc/letsencrypt/live/app.example.com/fullchain.pem
SSLCertificateKeyFile /etc/letsencrypt/live/app.example.com/privkey.pem
Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
</IfModule>
`

const CASES: DriverCase[] = [
  {
    driver: webServerDriver('nginx', null),
    file: NGINX_SITE,
    blockLine: 1,
    names: ['app.example.com', 'www.app.example.com'],
    certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem',
    keyPath: '/etc/letsencrypt/live/app.example.com/privkey.pem',
    keptLines: ['include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot', 'ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot']
  },
  {
    driver: apacheDriver('debian'),
    file: APACHE_SITE,
    blockLine: 2,
    names: ['app.example.com', 'www.app.example.com'],
    certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem',
    keyPath: '/etc/letsencrypt/live/app.example.com/privkey.pem',
    keptLines: ['Include /etc/letsencrypt/options-ssl-apache.conf']
  }
]

describe.each(CASES)('$driver.kind driver contract', ({ driver, file, blockLine, names, certPath, keyPath, keptLines }) => {
  it('reads the names and certificate paths of a site', () => {
    expect(driver.siteIdentity(file, blockLine)).toEqual({ names, certPath, keyPath })
  })

  it('replaces only the two certificate lines and keeps the TLS settings lines', () => {
    const swapped = driver.swapCertLines(file, blockLine, '/etc/ssl/shellway/app.example.com-1.pem', '/etc/ssl/shellway/app.example.com-1.key')
    expect(driver.siteIdentity(swapped.text, blockLine)).toEqual({ names, certPath: '/etc/ssl/shellway/app.example.com-1.pem', keyPath: '/etc/ssl/shellway/app.example.com-1.key' })
    for (const line of keptLines) expect(swapped.text).toContain(line)
    expect(swapped.diff.filter((line) => line.kind === 'remove')).toHaveLength(2)
    expect(swapped.diff.filter((line) => line.kind === 'add')).toHaveLength(2)
  })

  it('refuses a certificate path that could break out of the directive', () => {
    expect(() => driver.swapCertLines(file, blockLine, '/tmp/a; rm -rf /', '/tmp/b')).toThrow()
  })

  it('has a config test and a reload command', () => {
    expect(driver.testCommand).not.toBe('')
    expect(driver.reloadCommand).not.toBe('')
  })
})

describe('nginx driver', () => {
  it('keeps the commands Shellway always used', () => {
    const nginx = webServerDriver('nginx', null)
    expect([nginx.testCommand, nginx.reloadCommand, nginx.label]).toEqual(['nginx -t', 'nginx -s reload', 'nginx'])
  })
})

describe('apache driver', () => {
  it.each([
    { layout: 'debian' as const, commands: ['apache2ctl configtest', 'systemctl reload apache2'] },
    { layout: 'rhel' as const, commands: ['apachectl configtest', 'systemctl reload httpd'] }
  ])('uses the $layout service commands', ({ layout, commands }) => {
    const apache = apacheDriver(layout)
    expect([apache.kind, apache.label, apache.testCommand, apache.reloadCommand]).toEqual(['apache', 'Apache', ...commands])
  })
})

describe('servingDriver', () => {
  const apache = { version: '2.4.62', layout: 'rhel' as const }

  it('edits Apache with its own layout when Apache answers on the web ports', () => {
    const driver = servingDriver(makeFacts({ apache, serving: 'apache' }))
    expect([driver.kind, driver.testCommand]).toEqual(['apache', 'apachectl configtest'])
  })

  it('stays on nginx when nginx answers, even with Apache installed', () => {
    expect(servingDriver(makeFacts({ apache, serving: 'nginx' })).kind).toBe('nginx')
  })

  it('falls back to Apache when it is the only one installed', () => {
    expect(servingDriver(makeFacts({ nginx: null, apache, serving: null })).kind).toBe('apache')
  })
})
