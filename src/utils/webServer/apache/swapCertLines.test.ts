import { describe, expect, it } from 'vitest'
import { apacheSiteIdentity, swapApacheCertLines } from './swapCertLines'
import { fixture } from './testFixtures'

const NEW_CERT = '/etc/ssl/shellway/shop.example.com-1.pem'
const NEW_KEY = '/etc/ssl/shellway/shop.example.com-1.key'

const changes = (diff: { kind: string; text: string }[]) => diff.filter((line) => line.kind !== 'same').map((line) => `${line.kind} ${line.text}`)

describe('swapApacheCertLines', () => {
  it('replaces only the two certificate lines of the recorded -le-ssl.conf site', () => {
    const original = fixture('vhost-shop.example.com-le-ssl.conf')
    const swapped = swapApacheCertLines(original, 2, NEW_CERT, NEW_KEY)
    expect(swapped.text).toBe(original
      .replace('SSLCertificateFile /etc/letsencrypt/live/shop.example.com/fullchain.pem', `SSLCertificateFile ${NEW_CERT}`)
      .replace('SSLCertificateKeyFile /etc/letsencrypt/live/shop.example.com/privkey.pem', `SSLCertificateKeyFile ${NEW_KEY}`))
    expect(swapped.text).toContain('Include /etc/letsencrypt/options-ssl-apache.conf')
    expect(changes(swapped.diff)).toEqual([
      'remove SSLCertificateFile /etc/letsencrypt/live/shop.example.com/fullchain.pem',
      'remove SSLCertificateKeyFile /etc/letsencrypt/live/shop.example.com/privkey.pem',
      `add SSLCertificateFile ${NEW_CERT}`,
      `add SSLCertificateKeyFile ${NEW_KEY}`
    ])
  })

  it('edits only the VirtualHost at the given line and keeps its indentation', () => {
    const original = fixture('vhost-api.conf')
    const swapped = swapApacheCertLines(original, 8, NEW_CERT, NEW_KEY)
    expect(swapped.text).toContain(`    SSLCertificateFile ${NEW_CERT}\n    SSLCertificateKeyFile ${NEW_KEY}\n`)
    expect(swapped.text.split('\n').slice(0, 9)).toEqual(original.split('\n').slice(0, 9))
  })

  it('keeps tabs, CRLF line ends and SSLEngine inside an IfModule wrapper', () => {
    const original = [
      '<IfModule mod_ssl.c>',
      '<VirtualHost *:443>',
      '\tServerName shop.example.com',
      '\tSSLEngine on',
      '\t<IfModule mod_headers.c>',
      '\t\tSSLCertificateFile "/etc/ssl/old shop.pem"',
      '\t</IfModule>',
      '\tSSLCertificateKeyFile /etc/ssl/old.key',
      '</VirtualHost>',
      '</IfModule>',
      ''
    ].join('\r\n')
    const swapped = swapApacheCertLines(original, 2, NEW_CERT, NEW_KEY)
    expect(swapped.text).toBe(original
      .replace('\t\tSSLCertificateFile "/etc/ssl/old shop.pem"', `\t\tSSLCertificateFile ${NEW_CERT}`)
      .replace('\tSSLCertificateKeyFile /etc/ssl/old.key', `\tSSLCertificateKeyFile ${NEW_KEY}`))
    expect(swapped.text.split('\r\n')).toHaveLength(11)
  })

  it('replaces a directive split over a continuation line with one line', () => {
    const original = '<VirtualHost *:443>\n    SSLCertificateFile \\\n        /etc/ssl/old.pem\n    SSLCertificateKeyFile /etc/ssl/old.key\n</VirtualHost>\n'
    expect(swapApacheCertLines(original, 1, NEW_CERT, NEW_KEY).text).toBe(`<VirtualHost *:443>\n    SSLCertificateFile ${NEW_CERT}\n    SSLCertificateKeyFile ${NEW_KEY}\n</VirtualHost>\n`)
  })

  it.each([
    { name: 'the block is not at that line', text: fixture('vhost-api.conf'), line: 2, error: /line 2 was not found/ },
    { name: 'the site has no certificate', text: fixture('vhost-api.conf'), line: 1, error: /no SSLCertificateFile line/ },
    { name: 'the key line is missing', text: '<VirtualHost *:443>\n    SSLCertificateFile /etc/ssl/a.pem\n</VirtualHost>\n', line: 1, error: /no SSLCertificateKeyFile line/ },
    {
      name: 'the certificate line appears twice',
      text: '<VirtualHost *:443>\n    SSLCertificateFile /etc/ssl/a.pem\n    <IfModule mod_ssl.c>\n        SSLCertificateFile /etc/ssl/b.pem\n    </IfModule>\n    SSLCertificateKeyFile /etc/ssl/a.key\n</VirtualHost>\n',
      line: 1,
      error: /more than one SSLCertificateFile line/
    },
    {
      name: 'the key line appears twice',
      text: '<VirtualHost *:443>\n    SSLCertificateFile /etc/ssl/a.pem\n    SSLCertificateKeyFile /etc/ssl/a.key\n    sslcertificatekeyfile /etc/ssl/b.key\n</VirtualHost>\n',
      line: 1,
      error: /more than one SSLCertificateKeyFile line/
    },
    {
      name: 'the site also names a chain file',
      text: '<VirtualHost *:443>\n    SSLCertificateFile /etc/ssl/a.pem\n    SSLCertificateKeyFile /etc/ssl/a.key\n    SSLCertificateChainFile /etc/ssl/chain.pem\n</VirtualHost>\n',
      line: 1,
      error: /SSLCertificateChainFile/
    },
    {
      name: 'an earlier VirtualHost is never closed',
      text: '<VirtualHost *:80>\n    ServerName a.example.com\n<VirtualHost *:443>\n    SSLCertificateFile /etc/ssl/a.pem\n    SSLCertificateKeyFile /etc/ssl/a.key\n</VirtualHost>\n',
      line: 1,
      error: /do not open and close in order/
    },
    {
      name: 'a closing tag does not match its section',
      text: '<VirtualHost *:443>\n    <IfModule mod_ssl.c>\n    SSLCertificateFile /etc/ssl/a.pem\n    SSLCertificateKeyFile /etc/ssl/a.key\n</VirtualHost>\n    </IfModule>\n',
      line: 1,
      error: /do not open and close in order/
    },
    {
      name: 'the certificate is inside IfDefine',
      text: '<VirtualHost *:443>\n    <IfDefine TLS>\n        SSLCertificateFile /etc/ssl/a.pem\n    </IfDefine>\n    SSLCertificateKeyFile /etc/ssl/a.key\n</VirtualHost>\n',
      line: 1,
      error: /inside a conditional section/
    },
    {
      name: 'the key is inside a negated IfModule',
      text: '<VirtualHost *:443>\n    SSLCertificateFile /etc/ssl/a.pem\n    <IfModule !mod_headers.c>\n        SSLCertificateKeyFile /etc/ssl/a.key\n    </IfModule>\n</VirtualHost>\n',
      line: 1,
      error: /inside a conditional section/
    }
  ])('refuses when $name', ({ text, line, error }) => {
    expect(() => swapApacheCertLines(text, line, NEW_CERT, NEW_KEY)).toThrow(error)
  })

  it('does not treat a backslash followed by a space as a continuation', () => {
    const original = '<VirtualHost *:443>\n    # note \\ \n</VirtualHost>\n<VirtualHost *:8443>\n    SSLCertificateFile /etc/ssl/a.pem\n    SSLCertificateKeyFile /etc/ssl/a.key\n</VirtualHost>\n'
    expect(swapApacheCertLines(original, 4, NEW_CERT, NEW_KEY).text).toContain(`SSLCertificateFile ${NEW_CERT}`)
  })

  it.each(['/etc/ssl/a b.pem', '/etc/ssl/a.pem\nSSLEngine off', '"/etc/ssl/a.pem"', '/etc/ssl/$(id).pem'])('refuses the unsafe path %j', (path) => {
    const text = fixture('vhost-shop.example.com-le-ssl.conf')
    expect(() => swapApacheCertLines(text, 2, path, NEW_KEY)).toThrow(/not allowed/)
    expect(() => swapApacheCertLines(text, 2, NEW_CERT, path)).toThrow(/not allowed/)
  })
})

describe('apacheSiteIdentity', () => {
  it('reads lowercased names and certificate paths of the recorded -le-ssl.conf site', () => {
    expect(apacheSiteIdentity(fixture('vhost-shop.example.com-le-ssl.conf'), 2)).toEqual({
      names: ['shop.example.com', 'www.shop.example.com'],
      certPath: '/etc/letsencrypt/live/shop.example.com/fullchain.pem',
      keyPath: '/etc/letsencrypt/live/shop.example.com/privkey.pem'
    })
  })

  it('dedupes names that differ only by case and returns empty paths for a plain HTTP site', () => {
    const text = '<VirtualHost *:80>\n    ServerName Shop.Example.com\n    ServerAlias shop.example.com *.Shop.example.com\n</VirtualHost>\n'
    expect(apacheSiteIdentity(text, 1)).toEqual({ names: ['shop.example.com', '*.shop.example.com'], certPath: '', keyPath: '' })
  })
})
