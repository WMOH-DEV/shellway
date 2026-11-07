import { describe, expect, it } from 'vitest'
import { domainAddAction, domainRemoveAction, phpVersionAction, siteCommandAction } from './actions'
import { factsWith, makeInventory, VHOST_PATH, VHOST_REAL_PATH } from './fixtures/inventory'

const facts = factsWith(makeInventory())
const certificate = { lineage: 'app.example.com', names: ['app.example.com'] }

describe('sites.domain-add', () => {
  it('validates every field', () => {
    expect(() => domainAddAction.validate({ vhost: '/etc/passwd', anchor: 'app.example.com', domain: 'shop.example.com' })).toThrow('Invalid site file path')
    expect(() => domainAddAction.validate({ vhost: VHOST_PATH, anchor: 'app.example.com', domain: 'bad name' })).toThrow('not a valid domain')
    expect(() => domainAddAction.validate({ vhost: VHOST_PATH, anchor: 'app.example.com', domain: 'shop.example.com', certificate: { lineage: '; rm', names: ['a.example.com'] } })).toThrow('Invalid certificate name')
  })

  it('plans the site file edit with test and reload, then expands the certificate', () => {
    const params = domainAddAction.validate({ vhost: VHOST_PATH, anchor: 'app.example.com', domain: 'Shop.Example.com', certificate })
    const plan = domainAddAction.plan(params, facts)
    expect(plan.blocked).toBeNull()
    expect(plan.steps.map((s) => s.id)).toEqual(['edit-site-file', 'certificate', 'reload'])
    expect(plan.steps[0].display).toContain('nginx -t')
    expect(plan.steps[0].display).toContain(`write ${VHOST_REAL_PATH}`)
    expect(plan.steps[0].diff).toContain('+     server_name app.example.com shop.example.com;')
    expect(plan.steps[1].script).toBe('certbot certonly --nginx --non-interactive --cert-name app.example.com --expand -d app.example.com -d shop.example.com')
    expect(plan.steps[1].root).toBe(true)
    expect(plan.warnings[0]).toContain('DNS record for shop.example.com')
  })

  it('skips the certificate when the site has none', () => {
    const plan = domainAddAction.plan(domainAddAction.validate({ vhost: VHOST_PATH, anchor: 'app.example.com', domain: 'shop.example.com' }), facts)
    expect(plan.steps.map((s) => s.id)).toEqual(['edit-site-file'])
  })

  it('blocks when the site file was not read', () => {
    const plan = domainAddAction.plan(domainAddAction.validate({ vhost: '/etc/nginx/sites-available/other', anchor: 'app.example.com', domain: 'shop.example.com' }), facts)
    expect(plan.blocked?.message).toContain('could not read this site file')
  })
})

describe('sites.domain-remove', () => {
  it('shrinks the certificate to the remaining names', () => {
    const inventory = makeInventory({ vhosts: [{ path: VHOST_PATH, realPath: VHOST_PATH, sha256: 'b'.repeat(64), content: 'server {\n    server_name app.example.com shop.example.com;\n}\n' }] })
    const params = domainRemoveAction.validate({ vhost: VHOST_PATH, domain: 'shop.example.com', certificate: { lineage: 'app.example.com', names: ['app.example.com', 'shop.example.com'] } })
    const plan = domainRemoveAction.plan(params, factsWith(inventory))
    expect(plan.steps[1].script).toBe('certbot certonly --nginx --non-interactive --cert-name app.example.com -d app.example.com')
  })

  it('blocks removing the only name', () => {
    const plan = domainRemoveAction.plan(domainRemoveAction.validate({ vhost: VHOST_PATH, domain: 'app.example.com' }), facts)
    expect(plan.blocked?.message).toContain('at least one name')
  })
})

describe('sites.php-version', () => {
  it('switches the socket when that version is installed', () => {
    const plan = phpVersionAction.plan(phpVersionAction.validate({ vhost: VHOST_PATH, version: '8.4' }), facts)
    expect(plan.blocked).toBeNull()
    expect(plan.steps[0].diff).toContain('php8.4-fpm.sock')
  })

  it('blocks a version that is not installed or already in use', () => {
    expect(phpVersionAction.plan({ vhost: VHOST_PATH, version: '7.4' }, facts).blocked?.kind).toBe('unsupported')
    expect(phpVersionAction.plan({ vhost: VHOST_PATH, version: '8.3' }, facts).blocked?.message).toContain('already uses')
  })
})

describe('sites.command', () => {
  it('runs in the site folder as the connected user when they own it', () => {
    const plan = siteCommandAction.plan(siteCommandAction.validate({ site: 'app', command: ' php artisan migrate --force ' }), facts)
    expect(plan.steps[0].script).toBe("cd -- '/var/www/app' && php artisan migrate --force")
    expect(plan.steps[0].root).toBe(false)
  })

  it('switches to the folder owner when it differs', () => {
    const plan = siteCommandAction.plan({ site: 'app', command: 'npm run build' }, factsWith(makeInventory({ sites: [{ name: 'app', path: '/var/www/app', owner: 'www-data' }] })))
    expect(plan.steps[0].script).toBe("sudo -n -u www-data -H sh -c 'cd -- '\\''/var/www/app'\\'' && npm run build'")
  })

  it('rejects multi-line commands and unknown sites', () => {
    expect(() => siteCommandAction.validate({ site: 'app', command: 'ls\nrm -rf /' })).toThrow('single line')
    expect(siteCommandAction.plan({ site: 'nope', command: 'ls' }, facts).blocked).not.toBeNull()
  })
})
