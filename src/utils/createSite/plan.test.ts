import { describe, expect, it } from 'vitest'
import type { CreateSiteInput, PlanAction, TemplateId } from '@/types/createSite'
import { buildPlan, planMeta } from './plan'
import { ROOT_SHELL, enableModulesScript, folderScript } from './siteScripts'
import { TEMPLATES, siteFileText } from './templates'
import { APACHE_DEBIAN, APACHE_RHEL, NGINX, SERVER_CASES, allTools, baseInput, type ServerCase } from './testFixtures'

const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[]
const plan = (c: ServerCase, overrides: Partial<CreateSiteInput> = {}, tools = allTools()) =>
  buildPlan(baseInput({ server: c.server, ...overrides }), tools, c.driver)
const byId = (actions: PlanAction[], id: PlanAction['id']): PlanAction => {
  const found = actions.find((a) => a.id === id)
  if (!found) throw new Error(`no ${id} action`)
  return found
}

describe('buildPlan for the Laravel mockup on nginx', () => {
  const actions = plan(NGINX)

  it('lists the actions in run order with the mockup titles, summaries and chips', () => {
    expect(actions.map(({ id, title, summary, chip }) => ({ id, title, summary, chip }))).toEqual([
      { id: 'folder', title: 'Folder', summary: '/var/www/shop-deploy owned by deploy, and /var/www/shop pointing at its current release', chip: 'new' },
      { id: 'site', title: 'nginx site', summary: 'shop.conf from the Laravel template · PHP 8.3-fpm', chip: 'new' },
      { id: 'dns', title: 'DNS record', summary: 'A shop → 203.0.113.10 · CNAME www.shop → shop · both proxied', chip: 'new' },
      { id: 'https', title: 'HTTPS', summary: "Let's Encrypt via certbot · staging test first · HTTP → HTTPS redirect", chip: 'ready' },
      { id: 'deploys', title: 'Deploys', summary: 'acme/shop · main · Auto on server every 2 min · Laravel preset, 6 commands', chip: 'needs you' },
      { id: 'first-deploy', title: 'First deploy and check', summary: 'Deploy main, then https://shop.example.com/ must return 200', chip: 'ready' }
    ])
  })

  it('runs the folder and site scripts through sudo -n sh -s', () => {
    expect(byId(actions, 'folder')).toMatchObject({ commands: [ROOT_SHELL], script: folderScript('/var/www/shop', 'deploy') })
    const site = byId(actions, 'site')
    expect(site.commands).toEqual([ROOT_SHELL])
    expect(site.config).toBe(siteFileText(baseInput()))
    expect(site.script).toContain(site.config)
    expect(site.script).toContain('if ! nginx -t; then')
    expect(site.note).toBe('/etc/nginx/sites-available/shop.conf, linked into sites-enabled. nginx -t must pass before reload; otherwise the file is removed.')
  })

  it('creates the A and www CNAME records in the zone', () => {
    expect(byId(actions, 'dns')).toMatchObject({
      records: [
        { type: 'A', name: 'shop.example.com', content: '203.0.113.10', proxied: true },
        { type: 'CNAME', name: 'www.shop.example.com', content: 'shop.example.com', proxied: true }
      ],
      commands: [],
      note: 'Created in Cloudflare zone example.com with your token. Nothing else in the zone changes.'
    })
  })

  it('issues with a staging run first using the nginx plugin', () => {
    expect(byId(actions, 'https').commands).toEqual([
      'sudo -n certbot certonly --nginx --dry-run --non-interactive --agree-tos -m admin@example.com --cert-name shop.example.com -d shop.example.com -d www.shop.example.com',
      'sudo -n certbot --nginx --non-interactive --agree-tos -m admin@example.com --cert-name shop.example.com -d shop.example.com -d www.shop.example.com --redirect'
    ])
  })

  it('every command needs root through sudo -n', () => {
    expect(actions.flatMap((a) => a.commands).every((command) => command.startsWith('sudo -n '))).toBe(true)
  })
})

describe('buildPlan on Apache', () => {
  it('Debian: enables only the missing modules before the site', () => {
    const actions = plan(APACHE_DEBIAN, {}, allTools({ apacheModules: ['headers', 'ssl'] }))
    expect(actions.map((a) => a.id)).toEqual(['folder', 'modules', 'site', 'dns', 'https', 'deploys', 'first-deploy'])
    expect(byId(actions, 'modules')).toEqual({
      id: 'modules',
      title: 'Apache modules',
      summary: 'rewrite, proxy_fcgi, setenvif to enable',
      chip: '3 to enable',
      commands: [ROOT_SHELL],
      script: enableModulesScript(APACHE_DEBIAN.server, ['rewrite', 'proxy_fcgi', 'setenvif'], ['php8.3-fpm']),
      config: null,
      records: [],
      note: 'Checked with apache2ctl -M. Only missing modules are enabled, nothing is disabled. Applied together with the site below.'
    })
  })

  it('Debian: says which template modules are already on', () => {
    const actions = plan(APACHE_DEBIAN, {}, allTools({ apacheModules: ['rewrite', 'setenvif'] }))
    expect(byId(actions, 'modules')).toMatchObject({ summary: 'proxy_fcgi to enable · rewrite, setenvif already on', chip: '1 to enable' })
    expect(byId(actions, 'modules').script).toBe(enableModulesScript(APACHE_DEBIAN.server, ['proxy_fcgi'], ['php8.3-fpm']))
  })

  it('Debian: the site uses a2ensite and the Apache certbot plugin', () => {
    const actions = plan(APACHE_DEBIAN)
    expect(byId(actions, 'site')).toMatchObject({
      title: 'Apache site',
      summary: 'shop.conf from the Laravel template · PHP 8.3-fpm via proxy_fcgi',
      note: '/etc/apache2/sites-available/shop.conf, enabled with a2ensite. apache2ctl configtest must pass before reload; otherwise the site is disabled and removed.'
    })
    expect(byId(actions, 'site').script).toContain("if ! a2ensite 'shop'; then")
    expect(byId(actions, 'https').commands.every((command) => command.includes(' --apache '))).toBe(true)
  })

  it('RHEL: missing modules block the plan with no commands', () => {
    const actions = plan(APACHE_RHEL, {}, allTools({ apacheModules: ['rewrite'] }))
    expect(byId(actions, 'modules')).toMatchObject({
      chip: 'blocked',
      summary: 'needs LoadModule proxy_fcgi_module, setenvif_module',
      commands: [],
      script: null
    })
    expect(byId(actions, 'site').note).toBe('/etc/httpd/conf.d/shop.conf, active because it is in conf.d. apachectl configtest must pass before reload; otherwise the file is removed.')
  })

  it.each([APACHE_DEBIAN, APACHE_RHEL])('$name: no modules step when all are loaded', (c) => {
    expect(plan(c).map((a) => a.id)).not.toContain('modules')
  })

  it.each(['static', 'blank'] as TemplateId[])('%s needs no modules', (template) => {
    expect(plan(APACHE_DEBIAN, { template }, allTools({ apacheModules: [] })).map((a) => a.id)).not.toContain('modules')
  })

  it('nginx never has a modules step', () => {
    expect(plan(NGINX, {}, allTools({ apacheModules: [] })).map((a) => a.id)).not.toContain('modules')
  })
})

describe('buildPlan per template and server', () => {
  const cases = SERVER_CASES.flatMap((c) => TEMPLATE_IDS.map((template) => ({ ...c, template })))

  it.each(cases)('$name $template', ({ name, server, driver, template }) => {
    const input = baseInput({ server, template })
    const actions = buildPlan(input, allTools(), driver)
    const site = byId(actions, 'site')
    expect(actions.map((a) => a.id)).toEqual(['folder', 'site', 'dns', 'https', 'deploys', 'first-deploy'])
    expect(site.title).toBe(name === 'nginx' ? 'nginx site' : 'Apache site')
    expect(site.config).toBe(siteFileText(input))
    expect(site.script).toContain(`if ! ${driver.testCommand}; then`)
    expect(site.script).toContain(site.config)
    expect(byId(actions, 'deploys').summary).toContain(`${TEMPLATES[template].label === 'Blank' ? 'Custom' : TEMPLATES[template].label} preset`)
  })

  it.each([
    ['node', 'shop.conf from the Node.js template · proxy to 127.0.0.1:3000'],
    ['compose', 'shop.conf from the Docker Compose template · proxy to 127.0.0.1:3000'],
    ['static', 'shop.conf from the Static site template'],
    ['php', 'shop.conf from the PHP template · PHP 8.3-fpm']
  ] as Array<[TemplateId, string]>)('%s site summary', (template, summary) => {
    expect(byId(plan(NGINX, { template }), 'site').summary).toBe(summary)
  })
})

describe('buildPlan options', () => {
  it('skips the staging run and the redirect when not asked', () => {
    const https = byId(plan(NGINX, { https: { email: 'admin@example.com', redirect: false, staging: false } }), 'https')
    expect(https.summary).toBe("Let's Encrypt via certbot · no HTTP → HTTPS redirect")
    expect(https.commands).toEqual([expect.stringContaining('--no-redirect')])
  })

  it('without www: one name everywhere', () => {
    const actions = plan(NGINX, { includeWww: false })
    expect(byId(actions, 'dns').records).toHaveLength(1)
    expect(byId(actions, 'dns').summary).toBe('A shop → 203.0.113.10 · proxied')
    expect(byId(actions, 'https').commands[1]).not.toContain('www.')
  })

  it('DNS only when not proxied, @ for the zone apex', () => {
    const actions = plan(NGINX, { domain: 'example.com', dns: { zoneId: 'zone-1', zoneName: 'example.com', serverIp: '203.0.113.10', proxied: false } })
    expect(byId(actions, 'dns').summary).toBe('A @ → 203.0.113.10 · CNAME www → @ · DNS only')
  })

  it('no Cloudflare zone: the records to create by hand, never proxied', () => {
    const dns = byId(plan(NGINX, { dns: { zoneId: null, zoneName: null, serverIp: '203.0.113.10', proxied: true } }), 'dns')
    expect(dns).toMatchObject({
      chip: 'needs you',
      summary: 'A shop.example.com → 203.0.113.10 · CNAME www.shop.example.com → shop.example.com · create by hand',
      note: 'No Cloudflare zone for this domain. Create the record at your DNS provider, then press Check again.'
    })
    expect(dns.records.every((record) => !record.proxied)).toBe(true)
  })

  it('no DNS details at all: points the names at this server by hand', () => {
    expect(byId(plan(NGINX, { dns: null }), 'dns')).toMatchObject({
      chip: 'needs you',
      summary: 'Point shop.example.com and www.shop.example.com at this server by hand',
      records: []
    })
  })

  it('From my PC needs no deploy key', () => {
    expect(byId(plan(NGINX, { sourceMode: 'pc' }), 'deploys')).toMatchObject({
      summary: 'acme/shop · main · From my PC · Laravel preset, 6 commands',
      chip: 'ready',
      note: ''
    })
  })

  it('checks the chosen health path', () => {
    expect(byId(plan(NGINX, { healthPath: '/up' }), 'first-deploy').summary).toBe('Deploy main, then https://shop.example.com/up must return 200')
  })

  it('refuses a driver for another web server', () => {
    expect(() => buildPlan(baseInput({ server: APACHE_DEBIAN.server }), allTools(), NGINX.driver)).toThrow('cannot manage')
  })
})

describe('buildPlan refuses unsafe input', () => {
  it.each([
    ['owner', { owner: 'deploy; id' }],
    ['owner with a newline', { owner: 'deploy\nroot' }],
    ['server IP', { dns: { zoneId: 'zone-1', zoneName: 'example.com', serverIp: '203.0.113.10; id', proxied: true } }],
    ['IPv4 out of range', { dns: { zoneId: 'zone-1', zoneName: 'example.com', serverIp: '203.0.113.256', proxied: true } }],
    ['domain outside the zone', { dns: { zoneId: 'zone-1', zoneName: 'example.org', serverIp: '203.0.113.10', proxied: true } }],
    ['zone name', { domain: 'shop.example.com', dns: { zoneId: 'zone-1', zoneName: 'example.com\n', serverIp: '203.0.113.10', proxied: true } }],
    ['health path', { healthPath: '/up; id' }],
    ['health path with a newline', { healthPath: '/\n' }],
    ['relative health path', { healthPath: 'up' }],
    ['email', { https: { email: 'admin@example.com -d evil.example.net', redirect: true, staging: true } }],
    ['domain', { domain: 'example.com; rm -rf /' }],
    ['folder', { folder: '/var/www/../../etc' }],
    ['php version', { phpVersion: '8.3\n' }]
  ] as Array<[string, Partial<CreateSiteInput>]>)('%s', (_what, overrides) => {
    expect(() => plan(NGINX, overrides)).toThrow()
  })
})

describe('planMeta', () => {
  it('estimates minutes and reports the sudo requirement', () => {
    expect(planMeta(plan(NGINX))).toEqual({ minutes: 6, needsFullSudo: true })
    expect(planMeta(plan(APACHE_DEBIAN, {}, allTools({ apacheModules: [] })))).toEqual({ minutes: 6, needsFullSudo: true })
  })

  it('needs no sudo when nothing runs as root', () => {
    const actions = plan(NGINX).filter((a) => a.commands.length === 0)
    expect(planMeta(actions)).toEqual({ minutes: 4, needsFullSudo: false })
  })
})

describe('buildPlan PHP and composer steps', () => {
  const php = (installed: string[], installable: string[], missing: string[] = []) =>
    ({ installed, installable, missingPackages: Object.fromEntries(installed.map((v) => [v, missing])) })

  it('adds nothing when the chosen PHP and composer are already there', () => {
    expect(plan(NGINX).map((a) => a.id)).not.toContain('php')
    expect(plan(NGINX).map((a) => a.id)).not.toContain('composer')
  })

  it('installs a PHP version from the server package sources first, then composer', () => {
    const actions = plan(NGINX, { phpVersion: '8.5' }, allTools({ php: php(['8.4'], ['8.5']), composer: false }))
    expect(actions.map((a) => a.id).slice(0, 3)).toEqual(['php', 'composer', 'folder'])
    expect(byId(actions, 'php')).toMatchObject({ summary: 'Install PHP 8.5 with the extensions Laravel needs', chip: 'installs', commands: [ROOT_SHELL] })
    expect(byId(actions, 'php').script).toContain('install -y --no-remove php8.5-fpm php8.5-cli')
    expect(byId(actions, 'composer').script).toContain('php=php8.5;')
  })

  it('adds only the missing required packages to an installed version', () => {
    const actions = plan(NGINX, { phpVersion: '8.3' }, allTools({ php: php(['8.3'], [], ['php8.3-zip']) }))
    expect(byId(actions, 'php').summary).toBe('Add php8.3-zip to PHP 8.3')
    expect(byId(actions, 'php').script).toContain('install -y --no-remove php8.3-zip\n')
  })

  it('blocks a version the server can neither run nor install', () => {
    expect(byId(plan(NGINX, { phpVersion: '8.6' }), 'php')).toMatchObject({ chip: 'blocked', script: null })
  })

  it('leaves PHP and composer out of templates that do not use them', () => {
    const ids = plan(NGINX, { template: 'static' }, allTools({ php: php([], []), composer: false })).map((a) => a.id)
    expect(ids).not.toContain('php')
    expect(ids).not.toContain('composer')
  })
})

describe('buildPlan pm2 step', () => {
  it('installs pm2 and starts it on boot when it is missing', () => {
    const pm2 = byId(plan(NGINX, { template: 'node' }, allTools({ pm2: false, pm2Startup: false })), 'pm2')
    expect(pm2).toMatchObject({ summary: 'Install pm2 with npm and start pm2-deploy on boot', chip: 'installs', commands: [ROOT_SHELL] })
    expect(pm2.script).toContain('npm install -g pm2')
    expect(pm2.script).toContain(`pm2 startup systemd -u 'deploy' --hp "$home"`)
  })

  it('only turns on start at boot when pm2 is there but not set to start', () => {
    const pm2 = byId(plan(NGINX, { template: 'node' }, allTools({ pm2Startup: false })), 'pm2')
    expect(pm2.summary).toBe('Start pm2-deploy on boot so the app comes back after a restart')
    expect(pm2.script).not.toContain('npm install')
  })

  it('adds nothing when pm2 is installed and starts on boot, or for other templates', () => {
    expect(plan(NGINX, { template: 'node' }).map((a) => a.id)).not.toContain('pm2')
    expect(plan(NGINX, {}, allTools({ pm2: false })).map((a) => a.id)).not.toContain('pm2')
  })

  it('counts the pm2 commands in the Deploys summary', () => {
    expect(byId(plan(NGINX, { template: 'node' }), 'deploys').summary).toContain('Node.js preset, 3 commands')
  })
})
