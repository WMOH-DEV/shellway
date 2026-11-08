import { describe, expect, it } from 'vitest'
import { addDomain, phpVersionIn, removeDomain, vhostLogs, vhostServer, withPhpVersion } from './vhost'

const NGINX = [
  'server {',
  '    listen 80;',
  '    server_name app.example.com www.app.example.com;',
  '    return 301 https://$host$request_uri;',
  '}',
  'server {',
  '    listen 443 ssl;',
  '    server_name app.example.com www.app.example.com; # managed',
  '    root /var/www/app/current/public;',
  '    access_log /var/log/nginx/app.access.log;',
  '    location ~ \\.php$ { fastcgi_pass unix:/run/php/php8.3-fpm.sock; }',
  '}',
  'server {',
  '    server_name other.example.com;',
  '}',
  ''
].join('\n')

const APACHE = [
  '<VirtualHost *:80>',
  '    ServerName app.example.com',
  '    ServerAlias www.app.example.com',
  '    ErrorLog ${APACHE_LOG_DIR}/app-error.log',
  '    <FilesMatch \\.php$>',
  '        SetHandler "proxy:unix:/run/php/php8.2-fpm.sock|fcgi://localhost"',
  '    </FilesMatch>',
  '</VirtualHost>',
  '<VirtualHost *:80>',
  '    ServerName other.example.com',
  '</VirtualHost>',
  ''
].join('\n')

const nginx = vhostServer('/etc/nginx/sites-available/app')!
const apache = vhostServer('/etc/apache2/sites-available/app.conf')!

describe('vhostServer', () => {
  it('reads the web server from the file location', () => {
    expect(nginx).toEqual({ kind: 'nginx', layout: null })
    expect(apache).toEqual({ kind: 'apache', layout: 'debian' })
    expect(vhostServer('/etc/httpd/conf.d/app.conf')).toEqual({ kind: 'apache', layout: 'rhel' })
    expect(vhostServer('/srv/app.conf')).toBeNull()
  })
})

describe('nginx domains', () => {
  it('adds the name to every server block of the site and leaves other sites alone', () => {
    const next = addDomain(NGINX, nginx, 'app.example.com', 'shop.example.com')
    expect(next).toContain('    server_name app.example.com www.app.example.com shop.example.com;\n    return')
    expect(next).toContain('    server_name app.example.com www.app.example.com shop.example.com; # managed')
    expect(next).toContain('    server_name other.example.com;')
  })

  it('refuses a name that is already listed', () => {
    expect(() => addDomain(NGINX, nginx, 'app.example.com', 'www.app.example.com')).toThrow('already listed')
  })

  it('refuses when the anchor name is not in the file', () => {
    expect(() => addDomain(NGINX, nginx, 'missing.example.com', 'shop.example.com')).toThrow('No server_name line')
  })

  it('removes a name and refuses to leave a block without names', () => {
    expect(removeDomain(NGINX, nginx, 'www.app.example.com')).not.toContain('www.app.example.com')
    expect(() => removeDomain(NGINX, nginx, 'other.example.com')).toThrow('at least one name')
  })
})

describe('apache domains', () => {
  it('adds a ServerAlias line after the last name line of the matching VirtualHost', () => {
    const lines = addDomain(APACHE, apache, 'app.example.com', 'shop.example.com').split('\n')
    expect(lines.slice(1, 4)).toEqual(['    ServerName app.example.com', '    ServerAlias www.app.example.com', '    ServerAlias shop.example.com'])
    expect(lines.filter((l) => l.includes('shop.example.com'))).toHaveLength(1)
  })

  it('removes an alias line and refuses to remove the main name', () => {
    expect(removeDomain(APACHE, apache, 'www.app.example.com')).not.toContain('ServerAlias')
    expect(() => removeDomain(APACHE, apache, 'app.example.com')).toThrow('main name')
    expect(() => removeDomain(APACHE, apache, 'none.example.com')).toThrow('not listed')
  })
})

describe('php version', () => {
  it('reads and switches the FPM socket', () => {
    expect(phpVersionIn(NGINX)).toBe('8.3')
    expect(withPhpVersion(NGINX, '8.4')).toContain('php8.4-fpm.sock')
    expect(phpVersionIn(APACHE)).toBe('8.2')
  })

  it('refuses a file without a single socket', () => {
    expect(() => withPhpVersion('server { }', '8.4')).toThrow('single PHP-FPM socket')
    expect(phpVersionIn('php8.2-fpm.sock php8.3-fpm.sock')).toBeNull()
  })
})

describe('vhostLogs', () => {
  it('uses the site log lines and falls back to the defaults', () => {
    expect(vhostLogs(NGINX, nginx)).toEqual({ error: '/var/log/nginx/error.log', access: '/var/log/nginx/app.access.log' })
    expect(vhostLogs(APACHE, apache)).toEqual({ error: '/var/log/apache2/app-error.log', access: '/var/log/apache2/access.log' })
    expect(vhostLogs('', { kind: 'apache', layout: 'rhel' })).toEqual({ error: '/var/log/httpd/error_log', access: '/var/log/httpd/access_log' })
  })

  it('ignores log paths outside the web server log folders', () => {
    expect(vhostLogs('access_log /tmp/x.log;', nginx).access).toBe('/var/log/nginx/access.log')
  })
})
