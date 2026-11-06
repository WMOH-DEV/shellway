import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import {
  hasConfigFiles,
  parseCertbotCertificates,
  parseCertificate,
  parseFacts,
  parseProbes,
  parseServerBlocks,
  splitSections
} from './parse'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')
const epoch = (...parts: [number, number, number, number, number, number]) => Date.UTC(...parts) / 1000

describe('parseServerBlocks', () => {
  const blocks = parseServerBlocks(fixture('nginx-T.txt'))
  const byId = (id: string) => blocks.find((b) => b.id === id)!

  it('keeps the server-level root, not one inside a location', () => {
    expect(byId('/etc/nginx/sites-enabled/app.example.com:9').root).toBeNull()
    const dump = '# configuration file /etc/nginx/sites-enabled/site:\nserver {\n    server_name site.example.com;\n    root /var/www/site/current/public;\n}\n'
    expect(parseServerBlocks(dump)[0].root).toBe('/var/www/site/current/public')
  })

  it('finds every server block across included files', () => {
    expect(blocks.map((b) => b.id)).toEqual([
      '/etc/nginx/conf.d/status.conf:1',
      '/etc/nginx/sites-enabled/app.example.com:2',
      '/etc/nginx/sites-enabled/app.example.com:9',
      '/etc/nginx/sites-enabled/example.net:1',
      '/etc/nginx/sites-enabled/example.net:9',
      '/etc/nginx/sites-enabled/catchall:1',
      '/etc/nginx/sites-enabled/misc:1',
      '/etc/nginx/sites-enabled/misc:9',
      '/etc/nginx/sites-enabled/misc:16',
      '/etc/nginx/sites-enabled/misc:23'
    ])
  })

  it('ignores server blocks that sit inside comments', () => {
    expect(blocks.flatMap((b) => b.names)).not.toContain('commented.example.com')
  })

  it('keeps the HTTP redirect block and the 443 block for the same names apart', () => {
    const redirect = byId('/etc/nginx/sites-enabled/app.example.com:2')
    const secure = byId('/etc/nginx/sites-enabled/app.example.com:9')
    expect(redirect).toMatchObject({ names: ['app.example.com', 'www.example.com'], tls: false, certPath: '', keyPath: '', probeAddress: '127.0.0.1:443' })
    expect(secure).toMatchObject({
      names: ['app.example.com', 'www.example.com'],
      tls: true,
      certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem',
      keyPath: '/etc/letsencrypt/live/app.example.com/privkey.pem',
      probeAddress: '127.0.0.1:443'
    })
  })

  it('survives nested braces and quoted braces inside locations', () => {
    const secure = byId('/etc/nginx/sites-enabled/app.example.com:9')
    expect(secure.certPath).not.toBe('')
    expect(blocks.some((b) => b.id.endsWith('app.example.com:16'))).toBe(false)
  })

  it('joins several server_name lines and unquotes quoted names', () => {
    const block = byId('/etc/nginx/sites-enabled/example.net:1')
    expect(block.names).toEqual(['example.net', '*.example.net'])
  })

  it('probes the specific address of the listen directive', () => {
    expect(byId('/etc/nginx/sites-enabled/example.net:1').probeAddress).toBe('203.0.113.10:443')
  })

  it('brackets a specific IPv6 address', () => {
    expect(byId('/etc/nginx/sites-enabled/example.net:9').probeAddress).toBe('[2001:db8::20]:443')
  })

  it('keeps wildcard and regex names as written', () => {
    const block = byId('/etc/nginx/sites-enabled/catchall:1')
    expect(block.names).toEqual(['_', '~^(?<sub>.+)\\.example\\.org$', '~^www\\d{2}\\.example\\.org$', '*.example.org'])
    expect(block.tls).toBe(true)
  })

  it('treats quic and bare 443 with a certificate as TLS', () => {
    expect(byId('/etc/nginx/sites-enabled/misc:1')).toMatchObject({ names: ['quic.example.com'], tls: true })
    expect(byId('/etc/nginx/sites-enabled/misc:9')).toMatchObject({ names: ['bare443.example.com'], tls: true, probeAddress: '127.0.0.1:443' })
  })

  it('probes the listening port when TLS is not on 443', () => {
    expect(byId('/etc/nginx/sites-enabled/misc:16')).toMatchObject({ names: ['alt.example.com'], tls: true, probeAddress: '127.0.0.1:8443' })
  })

  it('marks plain HTTP blocks as not TLS', () => {
    expect(byId('/etc/nginx/sites-enabled/misc:23')).toMatchObject({ names: ['plain.example.com'], tls: false })
    expect(byId('/etc/nginx/conf.d/status.conf:1').tls).toBe(false)
  })

  it('treats a lone 443 listener without a certificate as not TLS', () => {
    const [block] = parseServerBlocks('# configuration file /etc/nginx/x.conf:\nserver { listen 443; server_name a.example.com; }\n')
    expect(block.tls).toBe(false)
  })

  it('reads wildcard listen forms as the local address', () => {
    const dump = '# configuration file /f:\nserver { listen *:443 ssl; listen 0.0.0.0:443 ssl; server_name a.example.com; }\nserver { listen [::]:443 ssl; server_name b.example.com; }\n'
    expect(parseServerBlocks(dump).map((b) => b.probeAddress)).toEqual(['127.0.0.1:443', '127.0.0.1:443'])
  })

  it('returns nothing for text with no configuration files', () => {
    expect(parseServerBlocks('nginx: command not found')).toEqual([])
    expect(hasConfigFiles('nginx: command not found')).toBe(false)
    expect(hasConfigFiles(fixture('nginx-T.txt'))).toBe(true)
  })
})

describe('parseCertbotCertificates', () => {
  const lineages = parseCertbotCertificates(fixture('certbot-certificates.txt'))

  it('reads every lineage', () => {
    expect(lineages).toEqual([
      {
        name: 'app.example.com',
        domains: ['app.example.com', 'www.example.com'],
        notAfter: 1799741722,
        certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem',
        keyPath: '/etc/letsencrypt/live/app.example.com/privkey.pem'
      },
      {
        name: 'shop.example.net',
        domains: ['shop.example.net', '*.shop.example.net'],
        notAfter: 1795208650,
        certPath: '/etc/letsencrypt/live/shop.example.net/fullchain.pem',
        keyPath: '/etc/letsencrypt/live/shop.example.net/privkey.pem'
      }
    ])
  })

  it('returns an empty list when certbot has nothing', () => {
    expect(parseCertbotCertificates('No certificates found.')).toEqual([])
  })

  it('leaves the expiry empty when it cannot be read', () => {
    const [lineage] = parseCertbotCertificates('  Certificate Name: x.example.com\n    Domains: x.example.com\n    Expiry Date: soon\n')
    expect(lineage.notAfter).toBeNull()
  })
})

describe('parseCertificate', () => {
  it("recognises Let's Encrypt from OpenSSL 3 output", () => {
    expect(parseCertificate(fixture('x509-openssl3-le_leaf.txt'))).toEqual({
      kind: 'letsencrypt',
      subject: 'app.example.com',
      issuer: "Let's Encrypt · R11",
      names: ['app.example.com', 'www.example.com'],
      notBefore: epoch(2026, 10, 6, 19, 8, 20),
      notAfter: epoch(2027, 1, 4, 19, 8, 20),
      error: null
    })
  })

  it('recognises a Cloudflare Origin CA certificate, including the comma in its issuer', () => {
    const cert = parseCertificate(fixture('x509-openssl3-cf_leaf.txt'))
    expect(cert.kind).toBe('cloudflare-origin')
    expect(cert.issuer).toBe('CloudFlare, Inc. · CloudFlare Origin SSL Certificate Authority')
    expect(cert.names).toEqual(['example.net', '*.example.net'])
    expect(cert.notAfter).toBe(epoch(2041, 10, 2, 19, 8, 20))
  })

  it('recognises a self-signed certificate', () => {
    const cert = parseCertificate(fixture('x509-openssl3-ss.txt'))
    expect(cert).toMatchObject({ kind: 'self-signed', subject: 'localhost', names: ['localhost'] })
  })

  it('classifies a certificate from another authority as other', () => {
    const text = fixture('x509-openssl3-le_leaf.txt').replace("O=Let's Encrypt, CN=R11", 'O=Example Trust, CN=Example CA 1')
    expect(parseCertificate(text)).toMatchObject({ kind: 'other', issuer: 'Example Trust · Example CA 1' })
  })

  it('reads the older slash-separated subject format', () => {
    const cert = parseCertificate(fixture('x509-libressl-cf_leaf.txt'))
    expect(cert).toMatchObject({ kind: 'cloudflare-origin', subject: 'CloudFlare Origin Certificate', issuer: 'CloudFlare, Inc. · CloudFlare Origin SSL Certificate Authority' })
    expect(cert.names).toEqual([])
    expect(parseCertificate(fixture('x509-libressl-ss.txt')).kind).toBe('self-signed')
    expect(parseCertificate(fixture('x509-libressl-le_leaf.txt')).kind).toBe('letsencrypt')
  })

  it('reads names and dates from the -text fallback used by old OpenSSL', () => {
    const cert = parseCertificate(fixture('x509-text-le_leaf.txt'))
    expect(cert).toMatchObject({ kind: 'letsencrypt', names: ['app.example.com', 'www.example.com'], notAfter: epoch(2027, 1, 4, 19, 8, 20) })
    expect(parseCertificate(fixture('x509-text-cf_leaf.txt')).names).toEqual(['example.net', '*.example.net'])
  })

  it('reads the OpenSSL 1.1 spaced name format', () => {
    const text = [
      "subject=CN = app.example.com",
      "issuer=C = US, O = Let's Encrypt, CN = R3",
      'notBefore=Oct  1 00:00:00 2026 GMT',
      'notAfter=Dec 30 00:00:00 2026 GMT'
    ].join('\n')
    expect(parseCertificate(text)).toMatchObject({ kind: 'letsencrypt', subject: 'app.example.com', issuer: "Let's Encrypt · R3", notBefore: epoch(2026, 9, 1, 0, 0, 0) })
  })

  it('reports unreadable output as no certificate', () => {
    expect(parseCertificate('unable to load certificate')).toMatchObject({ kind: 'none', error: 'The certificate could not be read' })
  })
})

describe('parseProbes', () => {
  const targets = [
    { name: 'app.example.com', address: '127.0.0.1:443' },
    { name: 'example.net', address: '203.0.113.10:443' },
    { name: 'down.example.com', address: '127.0.0.1:443' },
    { name: 'slow.example.com', address: '127.0.0.1:443' },
    { name: 'lost.example.com', address: '127.0.0.1:443' }
  ]
  const output = [
    '@@SW@@ PROBE 0 ok',
    fixture('x509-openssl3-le_leaf.txt'),
    '@@SW@@ PROBE 1 ok',
    fixture('x509-text-cf_leaf.txt'),
    '@@SW@@ PROBE 2 nocert',
    '@@SW@@ PROBE 3 timeout',
    ''
  ].join('\n')
  const origins = parseProbes(output, targets)

  it('maps each probe to its name', () => {
    expect(origins['app.example.com'].kind).toBe('letsencrypt')
    expect(origins['example.net'].kind).toBe('cloudflare-origin')
  })

  it('explains a refused connection and a timeout in plain words', () => {
    expect(origins['down.example.com']).toMatchObject({ kind: 'none', error: 'No certificate presented on 127.0.0.1:443' })
    expect(origins['slow.example.com']).toMatchObject({ kind: 'none', error: 'Timed out connecting to 127.0.0.1:443' })
  })

  it('reports a probe that never ran', () => {
    expect(origins['lost.example.com']).toMatchObject({ kind: 'none', error: 'The server did not answer' })
  })
})

describe('splitSections', () => {
  it('splits on markers and keeps the argument', () => {
    expect(splitSections('@@SW@@ A\none\n@@SW@@ B x y\ntwo\n')).toEqual([
      { name: 'A', arg: '', body: 'one\n' },
      { name: 'B', arg: 'x y', body: 'two\n' }
    ])
  })
})

describe('parseFacts', () => {
  it('reads a healthy server with a certbot timer', () => {
    expect(parseFacts(fixture('facts-timer-success.txt'))).toEqual({
      nginx: '1.24.0',
      openssl: '3.0.13',
      certbot: '2.9.0',
      otherWebServer: null,
      renewal: {
        mechanism: 'certbot.timer',
        lastRun: 1793589247,
        lastResult: 'success',
        output: [
          'Nov 02 03:14:01 web1 systemd[1]: Starting certbot.service - Certbot...',
          'Nov 02 03:14:07 web1 certbot[1234]: Certificate not yet due for renewal',
          'Nov 02 03:14:07 web1 systemd[1]: certbot.service: Deactivated successfully.'
        ].join('\n')
      },
      sudo: { certbot: true, nginx: true, full: false },
      paths: { certbot: '/usr/bin/certbot', nginx: '/usr/sbin/nginx' },
      user: 'deploy',
      addresses: ['203.0.113.10', '198.51.100.7', '2001:db8::10']
    })
  })

  it('reads a failed snap renewal, Apache, and no sudo', () => {
    const facts = parseFacts(fixture('facts-timer-failed.txt'))
    expect(facts.renewal).toEqual({ mechanism: 'snap.certbot.renew.timer', lastRun: 1793414515, lastResult: 'failed', output: '' })
    expect(facts.otherWebServer).toBe('apache')
    expect(facts.sudo).toEqual({ certbot: false, nginx: false, full: false })
    expect(facts.openssl).toBe('1.1.1f')
    expect(facts.addresses).toEqual(['198.51.100.7'])
  })

  it('reads a bare server with cron renewal and Caddy', () => {
    const facts = parseFacts(fixture('facts-cron-bare.txt'))
    expect(facts.renewal).toEqual({ mechanism: 'cron', lastRun: null, lastResult: 'unknown', output: '' })
    expect(facts).toMatchObject({ nginx: null, certbot: null, otherWebServer: 'caddy', paths: { certbot: null, nginx: null }, addresses: [] })
  })

  it('reports no renewal when neither a timer nor cron exists', () => {
    const output = '@@SW@@ RENEWAL\ntimer=\n@@SW@@ JOURNAL\n'
    expect(parseFacts(output).renewal.mechanism).toBe('none')
  })

  it('does not call a timer that never ran a success', () => {
    const output = '@@SW@@ RENEWAL\ntimer=certbot.timer\nResult=success\nExecMainExitTimestamp=\n'
    expect(parseFacts(output).renewal).toMatchObject({ mechanism: 'certbot.timer', lastRun: null, lastResult: 'unknown' })
  })
})
