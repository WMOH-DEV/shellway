import { describe, expect, it } from 'vitest'
import { EMPTY_RUN_FORM, runPreview, siteRoute, suggestName, toRunInput, type RunForm } from './runForm'

const form: RunForm = {
  ...EMPTY_RUN_FORM,
  reference: 'acme/api:2.1',
  name: 'acme-api',
  ports: [{ host: '8081', container: '8080', protocol: 'tcp', isPublic: false }, { host: '', container: '', protocol: 'tcp', isPublic: false }],
  volumes: [{ source: '/srv/acme-api/data', target: '/data', readOnly: false }],
  env: [{ key: 'DATABASE_URL', value: 'postgres://app:hunter22@db/app' }, { key: '', value: '' }]
}

describe('run form', () => {
  it('suggests a container name from the image', () => {
    expect(suggestName('registry.example.com:5000/acme/My_API:2.1')).toBe('my_api')
    expect(suggestName('nginx')).toBe('nginx')
  })

  it('drops empty rows and maps the bind address', () => {
    const input = toRunInput({ ...form, ports: [{ host: '80', container: '80', protocol: 'tcp', isPublic: true }] }, false)
    expect(input).toMatchObject({ image: 'acme/api', tag: '2.1', ports: [{ host: 80, container: 80, bind: '0.0.0.0' }], env: [{ key: 'DATABASE_URL' }] })
  })

  it('defaults the tag and name', () => {
    expect(toRunInput({ ...EMPTY_RUN_FORM, reference: 'nginx' }, false)).toMatchObject({ image: 'nginx', tag: 'latest', name: 'nginx', ports: [] })
  })

  it('previews the docker run command without secrets', () => {
    const preview = runPreview(form, false)
    expect(preview).toMatchObject({ ok: true, text: 'docker run -d --name acme-api --restart unless-stopped -p 127.0.0.1:8081:8080 -v /srv/acme-api/data:/data --env-file /etc/shellway/docker/acme-api.env acme/api:2.1' })
    expect(preview.ok && preview.text).not.toContain('hunter22')
  })

  it('previews a compose stack and the site step', () => {
    const preview = runPreview({ ...form, onDomain: true, domain: 'api.example.com' }, true)
    expect(preview.ok && preview.text).toContain('cd /opt/stacks/acme-api && docker compose up -d')
    expect(preview.ok && preview.text).toContain('then: Create site api.example.com → 127.0.0.1:8081')
  })

  it('reports validation errors in plain words', () => {
    expect(runPreview({ ...form, ports: [{ host: 'abc', container: '80', protocol: 'tcp', isPublic: false }] }, false)).toEqual({ ok: false, error: 'Ports must be numbers from 1 to 65535' })
    expect(runPreview({ ...form, onDomain: true, domain: 'nope' }, false)).toEqual({ ok: false, error: 'Enter a domain like app.example.com' })
    expect(runPreview({ ...form, onDomain: true, domain: 'api.example.com', ports: [] }, false)).toEqual({ ok: false, error: 'Add a port so the site can reach the container' })
  })

  it('routes to Create site with prefilled params', () => {
    const preview = runPreview({ ...form, onDomain: true, domain: 'API.example.com' }, true)
    if (!preview.ok) throw new Error(preview.error)
    expect(siteRoute({ ...form, domain: 'API.example.com' }, preview.params)).toEqual({
      section: 'sites',
      sub: 'create',
      params: { template: 'compose', port: '8081', domain: 'api.example.com', path: '/opt/stacks/acme-api' }
    })
  })
})
