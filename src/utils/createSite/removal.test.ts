import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { CreatedDnsRecord, CreatedResources, RunRecord } from '@/types/createSite'
import { removalSteps, type RemovalStep } from './removal'
import { ROOT_SHELL, removeCertificateScript, removeFolderScript, removeSiteScript } from './siteScripts'
import { APACHE_DEBIAN, APACHE_RHEL, NGINX, SERVER_CASES, baseInput, type ServerCase } from './testFixtures'

const SHA = createHash('sha256').update('server {}\n').digest('hex')
const A: CreatedDnsRecord = { zoneId: 'zone-1', recordId: 'rec-a', name: 'shop.example.com', type: 'A' }
const CNAME: CreatedDnsRecord = { zoneId: 'zone-1', recordId: 'rec-www', name: 'www.shop.example.com', type: 'CNAME' }
const ORDER: RemovalStep['kind'][] = ['deploy-site', 'dns-record', 'site-file', 'certificate', 'folder']

const NO_RESOURCES: CreatedResources = { folder: null, siteFile: null, phpPool: null, database: null, envFile: null, modulesEnabled: [], dnsRecords: [], httpsSiteFile: null, certificate: null, deploySite: null }

const siteFileFor = ({ server }: ServerCase): CreatedResources['siteFile'] => {
  if (server.kind === 'nginx') return { path: '/etc/nginx/sites-available/shop.conf', enabledLink: '/etc/nginx/sites-enabled/shop.conf', sha256: SHA }
  if (server.layout === 'debian') return { path: '/etc/apache2/sites-available/shop.conf', enabledLink: '/etc/apache2/sites-enabled/shop.conf', sha256: SHA }
  return { path: '/etc/httpd/conf.d/shop.conf', enabledLink: null, sha256: SHA }
}

const record = (c: ServerCase, created: Partial<CreatedResources>): RunRecord => ({
  id: 'run-1',
  sessionId: 'session-1',
  domain: 'shop.example.com',
  createdAt: 1_800_000_000_000,
  server: c.server,
  input: baseInput({ server: c.server }),
  steps: [],
  created: { ...NO_RESOURCES, ...created },
  phase: 'failed',
  current: null,
  error: null,
  deployKey: null
})

const everything = (c: ServerCase): Partial<CreatedResources> => ({
  folder: { path: '/var/www/shop', createdByRun: true },
  siteFile: siteFileFor(c),
  modulesEnabled: ['rewrite', 'proxy_fcgi'],
  dnsRecords: [A, CNAME],
  certificate: { lineage: 'shop.example.com', issuedByRun: true },
  deploySite: 'shop'
})

describe('removalSteps', () => {
  it('removes everything the run created in reverse order', () => {
    expect(removalSteps(record(NGINX, everything(NGINX)), NGINX.driver)).toEqual([
      { kind: 'deploy-site', title: 'Deploy site shop', siteName: 'shop' },
      { kind: 'dns-record', title: 'DNS record A shop.example.com', zoneId: 'zone-1', recordId: 'rec-a', name: 'shop.example.com' },
      { kind: 'dns-record', title: 'DNS record CNAME www.shop.example.com', zoneId: 'zone-1', recordId: 'rec-www', name: 'www.shop.example.com' },
      {
        kind: 'site-file',
        title: 'nginx site /etc/nginx/sites-available/shop.conf',
        path: '/etc/nginx/sites-available/shop.conf',
        command: ROOT_SHELL,
        script: removeSiteScript({ driver: NGINX.driver, server: NGINX.server, siteName: 'shop', sha256: SHA })
      },
      { kind: 'certificate', title: 'Certificate shop.example.com', command: ROOT_SHELL, script: removeCertificateScript('shop.example.com') },
      { kind: 'folder', title: 'Folder /var/www/shop', path: '/var/www/shop', command: ROOT_SHELL, script: removeFolderScript('/var/www/shop') }
    ])
  })

  it('removes the HTTPS site file certbot added on Apache before the site file, and the certificate after both', () => {
    const httpsSiteFile = { path: '/etc/apache2/sites-available/shop-le-ssl.conf', sha256: SHA }
    const steps = removalSteps(record(APACHE_DEBIAN, { ...everything(APACHE_DEBIAN), httpsSiteFile }), APACHE_DEBIAN.driver)
    expect(steps.map((s) => s.title)).toEqual([
      'Deploy site shop',
      'DNS record A shop.example.com',
      'DNS record CNAME www.shop.example.com',
      'Apache site /etc/apache2/sites-available/shop-le-ssl.conf',
      'Apache site /etc/apache2/sites-available/shop.conf',
      'Certificate shop.example.com',
      'Folder /var/www/shop'
    ])
    expect(steps[3]).toMatchObject({ script: removeSiteScript({ driver: APACHE_DEBIAN.driver, server: APACHE_DEBIAN.server, siteName: 'shop-le-ssl', sha256: SHA }) })
  })

  it('removes nothing when the run created nothing', () => {
    expect(removalSteps(record(NGINX, {}), NGINX.driver)).toEqual([])
  })

  it('keeps a certificate the run did not issue and a folder it did not create', () => {
    const steps = removalSteps(record(NGINX, { ...everything(NGINX), certificate: { lineage: 'shop.example.com', issuedByRun: false }, folder: { path: '/var/www/shop', createdByRun: false } }), NGINX.driver)
    expect(steps.map((s) => s.kind)).toEqual(['deploy-site', 'dns-record', 'dns-record', 'site-file'])
  })

  it('never disables Apache modules', () => {
    const steps = removalSteps(record(APACHE_DEBIAN, { modulesEnabled: ['rewrite', 'proxy_fcgi', 'setenvif'] }), APACHE_DEBIAN.driver)
    expect(steps).toEqual([])
  })

  it('deletes each DNS record once and skips records without an id', () => {
    const steps = removalSteps(record(NGINX, { dnsRecords: [A, A, { ...CNAME, recordId: '' }] }), NGINX.driver)
    expect(steps).toEqual([{ kind: 'dns-record', title: 'DNS record A shop.example.com', zoneId: 'zone-1', recordId: 'rec-a', name: 'shop.example.com' }])
  })

  it.each(SERVER_CASES)('$name: removes the site file it wrote', (c) => {
    const [step] = removalSteps(record(c, { siteFile: siteFileFor(c) }), c.driver)
    expect(step).toMatchObject({ kind: 'site-file', command: ROOT_SHELL, script: removeSiteScript({ driver: c.driver, server: c.server, siteName: 'shop', sha256: SHA }) })
  })

  it.each([
    ['a file outside the site folder', { path: '/etc/nginx/nginx.conf', enabledLink: null, sha256: SHA }],
    ['a path that climbs out', { path: '/etc/nginx/sites-available/../nginx.conf', enabledLink: null, sha256: SHA }],
    ['an Apache path on nginx', { path: '/etc/apache2/sites-available/shop.conf', enabledLink: null, sha256: SHA }]
  ])('refuses %s', (_what, siteFile) => {
    expect(() => removalSteps(record(NGINX, { siteFile }), NGINX.driver)).toThrow()
  })

  it.each(['shop.example.com; rm -rf /', '../live', 'shop\nexample'])('refuses the certificate name %j', (lineage) => {
    expect(() => removalSteps(record(NGINX, { certificate: { lineage, issuedByRun: true } }), NGINX.driver)).toThrow('is not a valid certificate name')
  })
})

describe('removalSteps only ever touches what the run created', () => {
  const choices = {
    deploySite: [null, 'shop'],
    certificate: [null, { lineage: 'shop.example.com', issuedByRun: true }, { lineage: 'shop.example.com', issuedByRun: false }],
    dnsRecords: [[], [A], [A, CNAME]],
    folder: [null, { path: '/var/www/shop', createdByRun: true }, { path: '/var/www/shop', createdByRun: false }],
    modulesEnabled: [[], ['rewrite']],
    withSiteFile: [false, true]
  }
  const cases = SERVER_CASES.flatMap((c) =>
    choices.deploySite.flatMap((deploySite) =>
      choices.certificate.flatMap((certificate) =>
        choices.dnsRecords.flatMap((dnsRecords) =>
          choices.folder.flatMap((folder) =>
            choices.modulesEnabled.flatMap((modulesEnabled) =>
              choices.withSiteFile.map((withSiteFile) => ({
                c,
                created: { deploySite, certificate, dnsRecords, folder, modulesEnabled, siteFile: withSiteFile ? siteFileFor(c) : null, httpsSiteFile: null } as CreatedResources
              }))
            )
          )
        )
      )
    )
  )

  it(`holds for all ${cases.length} combinations`, () => {
    expect(cases).toHaveLength(SERVER_CASES.length * 2 * 3 * 3 * 3 * 2 * 2)
    for (const { c, created } of cases) {
      const steps = removalSteps(record(c, created), c.driver)
      const kinds = steps.map((s) => s.kind)
      expect(kinds).toEqual([...kinds].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)))
      expect(kinds.includes('deploy-site')).toBe(created.deploySite !== null)
      expect(kinds.includes('certificate')).toBe(created.certificate?.issuedByRun === true)
      expect(steps.flatMap((s) => (s.kind === 'dns-record' ? [s.recordId] : []))).toEqual(created.dnsRecords.map((r) => r.recordId))
      expect(kinds.includes('site-file')).toBe(created.siteFile !== null)
      expect(kinds.includes('folder')).toBe(created.folder?.createdByRun === true)
      expect(JSON.stringify(steps)).not.toMatch(/a2dismod|a2disconf|rm -rf/)
    }
  })

  it.each([APACHE_DEBIAN, APACHE_RHEL])('$name: never removes a site file of another layout', (c) => {
    const other = c === APACHE_DEBIAN ? APACHE_RHEL : APACHE_DEBIAN
    expect(() => removalSteps(record(c, { siteFile: siteFileFor(other) }), c.driver)).toThrow('is not a site file Shellway creates')
  })
})
