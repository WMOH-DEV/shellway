import { describe, expect, it } from 'vitest'
import type { CreateSiteInput, TemplateId } from '@/types/createSite'
import { APACHE_DEBIAN, APACHE_RHEL, NGINX, SERVER_CASES, baseInput } from '../testFixtures'
import { APACHE_TEMPLATES } from './apache'
import { TEMPLATES, siteFileText } from './index'
import { NGINX_TEMPLATES } from './nginx'

const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[]
const lines = (text: string): string[] => text.trimEnd().split('\n').map((line) => line.trim())

describe('nginx templates', () => {
  it('writes the Laravel site exactly as the plan shows it', () => {
    expect(NGINX_TEMPLATES.laravel(baseInput())).toBe([
      'server {',
      '    listen 80;',
      '    server_name shop.example.com www.shop.example.com;',
      '    root /var/www/shop/current/public;',
      '    index index.php;',
      '    location / { try_files $uri $uri/ /index.php?$query_string; }',
      '    location ~ \\.php$ { fastcgi_pass unix:/run/php/php8.3-fpm.sock; include snippets/fastcgi-php.conf; }',
      '    location ~ /\\.(?!well-known) { deny all; }',
      '}',
      ''
    ].join('\n'))
  })

  it.each([
    ['php', ['root /var/www/shop/current;', 'index index.php index.html;', 'location / { try_files $uri $uri/ =404; }', 'fastcgi_pass unix:/run/php/php8.3-fpm.sock']],
    ['static', ['root /var/www/shop/current;', 'index index.html;', 'location / { try_files $uri $uri/ =404; }', 'location ~ /\\.(?!well-known) { deny all; }']],
    ['blank', ['root /var/www/shop/current;', 'index index.html;']],
    ['node', ['proxy_pass http://127.0.0.1:3000;', 'proxy_set_header Upgrade $http_upgrade;', 'proxy_set_header Connection "upgrade";', 'proxy_set_header Host $host;']],
    ['compose', ['proxy_pass http://127.0.0.1:8080;', 'proxy_http_version 1.1;']]
  ] as Array<[TemplateId, string[]]>)('%s has its key lines', (template, expected) => {
    const text = NGINX_TEMPLATES[template](baseInput({ template, appPort: template === 'compose' ? 8080 : 3000 }))
    expect(lines(text)).toEqual(expect.arrayContaining(expected.map((line) => expect.stringContaining(line))))
  })

  it('proxies without a document root and PHP without a proxy', () => {
    expect(NGINX_TEMPLATES.node(baseInput({ template: 'node' }))).not.toContain('root ')
    expect(NGINX_TEMPLATES.php(baseInput({ template: 'php' }))).not.toContain('proxy_pass')
  })

  it('leaves out the www name when it is not asked for', () => {
    expect(NGINX_TEMPLATES.static(baseInput({ includeWww: false }))).toContain('    server_name shop.example.com;\n')
  })
})

describe('Apache templates', () => {
  it('writes the Laravel site on Debian exactly as the plan shows it', () => {
    expect(APACHE_TEMPLATES.laravel(baseInput({ server: APACHE_DEBIAN.server }))).toBe([
      '<VirtualHost *:80>',
      '    ServerName shop.example.com',
      '    ServerAlias www.shop.example.com',
      '    DocumentRoot /var/www/shop/current/public',
      '    <Directory /var/www/shop/current/public>',
      '        Options FollowSymLinks',
      '        AllowOverride All',
      '        Require all granted',
      '    </Directory>',
      '    <FilesMatch \\.php$>',
      '        SetHandler "proxy:unix:/run/php/php8.3-fpm.sock|fcgi://localhost"',
      '    </FilesMatch>',
      '    ErrorLog ${APACHE_LOG_DIR}/shop-error.log',
      '    CustomLog ${APACHE_LOG_DIR}/shop-access.log combined',
      '</VirtualHost>',
      ''
    ].join('\n'))
  })

  it('uses the RHEL log folder and PHP-FPM socket', () => {
    const text = APACHE_TEMPLATES.laravel(baseInput({ server: APACHE_RHEL.server }))
    expect(text).toContain('    ErrorLog logs/shop-error.log\n    CustomLog logs/shop-access.log combined\n')
    expect(text).toContain('SetHandler "proxy:unix:/run/php-fpm/www.sock|fcgi://localhost"')
    expect(text).not.toContain('APACHE_LOG_DIR')
  })

  it.each([
    ['php', ['DocumentRoot /var/www/shop/current', '<Directory /var/www/shop/current>', 'AllowOverride All', 'SetHandler "proxy:unix:/run/php/php8.3-fpm.sock|fcgi://localhost"']],
    ['static', ['DocumentRoot /var/www/shop/current', 'Options FollowSymLinks', 'AllowOverride None', 'Require all granted']],
    ['blank', ['DocumentRoot /var/www/shop/current', 'AllowOverride None']],
    ['node', ['ProxyPreserveHost On', 'ProxyPass /.well-known/acme-challenge/ !', 'ProxyPass / http://127.0.0.1:3000/', 'ProxyPassReverse / http://127.0.0.1:3000/']],
    ['compose', ['ProxyPass / http://127.0.0.1:8080/', 'ProxyPassReverse / http://127.0.0.1:8080/']]
  ] as Array<[TemplateId, string[]]>)('%s has its key lines', (template, expected) => {
    const text = APACHE_TEMPLATES[template](baseInput({ template, server: APACHE_DEBIAN.server, appPort: template === 'compose' ? 8080 : 3000 }))
    expect(lines(text)).toEqual(expect.arrayContaining(expected))
  })

  it('refuses to write an Apache site for nginx', () => {
    expect(() => APACHE_TEMPLATES.static(baseInput({ server: NGINX.server }))).toThrow('need an Apache server')
  })
})

describe('siteFileText', () => {
  const cases = SERVER_CASES.flatMap(({ name, server }) => TEMPLATE_IDS.map((template) => ({ name, server, template })))

  it.each(cases)('$name $template names the domain and ends with a newline', ({ server, template }) => {
    const text = siteFileText(baseInput({ server, template }))
    const nameLine = server.kind === 'nginx' ? 'server_name shop.example.com www.shop.example.com;' : 'ServerName shop.example.com'
    expect(lines(text)).toContain(nameLine)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toMatch(/\n\n/)
  })
})

describe('template catalog', () => {
  it.each([
    ['laravel', 'laravel', ['rewrite', 'proxy_fcgi', 'setenvif']],
    ['php', 'php', ['rewrite', 'proxy_fcgi', 'setenvif']],
    ['node', 'node', ['proxy', 'proxy_http']],
    ['compose', 'compose', ['proxy', 'proxy_http']],
    ['static', 'static', []],
    ['blank', 'custom', []]
  ] as const)('%s uses the %s preset and Apache modules %j', (id, preset, modules) => {
    expect(TEMPLATES[id]).toMatchObject({ id, preset, apacheModules: modules, healthPath: '/' })
  })
})

describe('refuses values that could break out of the file or a root shell', () => {
  type Field = Partial<CreateSiteInput>
  const BAD_ALWAYS: Array<[string, Field]> = [
    ['domain with a command', { domain: 'example.com; rm -rf /' }],
    ['domain with a newline', { domain: 'example.com\nlisten 81' }],
    ['domain with a space', { domain: 'example.com other.example.com' }],
    ['uppercase domain', { domain: 'Example.com' }],
    ['site name with a path', { siteName: '../shop' }],
    ['site name with a newline', { siteName: 'shop\nx' }],
    ['site name with a quote', { siteName: "shop'" }],
    ['folder going up', { folder: '/var/www/../etc' }],
    ['folder with a command', { folder: '/var/www/shop; rm -rf /' }],
    ['relative folder', { folder: 'var/www/shop' }],
    ['folder with a newline', { folder: '/var/www/shop\n' }],
    ['root folder', { folder: '/' }]
  ]
  const BAD_PHP: Array<[string, Field]> = [
    ['php version with a command', { phpVersion: '8.3; id' }],
    ['php version with a newline', { phpVersion: '8.3\n' }],
    ['php version going up', { phpVersion: '../8' }]
  ]
  const BAD_PORT: Array<[string, Field]> = [
    ['port zero', { appPort: 0 }],
    ['port too high', { appPort: 70000 }],
    ['fractional port', { appPort: 3000.5 }]
  ]
  const usesPhp = (template: TemplateId) => template === 'laravel' || template === 'php'
  const proxies = (template: TemplateId) => template === 'node' || template === 'compose'

  const cases = SERVER_CASES.flatMap(({ name, server }) =>
    TEMPLATE_IDS.flatMap((template) => [
      ...BAD_ALWAYS,
      ...(usesPhp(template) && name !== 'apache rhel' ? BAD_PHP : []),
      ...(proxies(template) ? BAD_PORT : [])
    ].map(([what, field]) => ({ what, label: `${name} ${template}`, input: baseInput({ server, template, ...field }) })))
  )

  it.each(cases)('$label: $what', ({ input }) => {
    expect(() => siteFileText(input)).toThrow(/is not (a|an) /)
  })
})
