import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CreatedResources, RunRecord } from '@/types/createSite'
import { deletePreview, leftoverSizesScript, leftoversOf, withSizes } from './deletion'
import { deleteSteps } from './removal'
import { NGINX, baseInput } from './testFixtures'

const NOTHING: CreatedResources = { folder: null, repo: null, localCopy: null, siteFile: null, phpPool: null, database: null, envFile: null, jobs: null, modulesEnabled: [], dnsRecords: [], httpsSiteFile: null, certificate: null, deploySite: null }

const record = (created: Partial<CreatedResources>, changes: Partial<RunRecord> = {}): RunRecord => ({
  id: 'run-1',
  sessionId: 'session-1',
  domain: 'shop.example.com',
  createdAt: 1,
  server: NGINX.server,
  input: baseInput(),
  steps: [],
  created: { ...NOTHING, ...created },
  phase: 'done',
  current: null,
  error: null,
  deployKey: null,
  ...changes
})

describe('leftoversOf', () => {
  it('lists the folder and database with the exact commands to delete them by hand', () => {
    const items = leftoversOf(record({ folder: { path: '/var/www/shop', createdByRun: true }, database: { engine: 'mysql', name: 'shop', user: 'shop' } }))
    expect(items[0]).toEqual({
      id: 'folder',
      title: 'The site folder /var/www/shop-deploy with every release, uploaded files and the .env file, and the link /var/www/shop',
      command: "sudo rm -rf '/var/www/shop-deploy' '/var/www/shop'",
      size: null
    })
    expect(items[1]).toEqual({
      id: 'database',
      title: 'The MySQL database shop with every table and row, and its user shop',
      command: "sudo mysql <<'SQL'\nDROP DATABASE IF EXISTS `shop`;\nDROP USER IF EXISTS 'shop'@'localhost';\nSQL",
      size: null
    })
  })

  it('names the deploy key left on the repository and the Docker volumes of a Compose app', () => {
    const titles = leftoversOf(record({}, { deployKey: 'ssh-ed25519 AAAA', input: baseInput({ template: 'compose', database: null }) })).map((item) => item.title)
    expect(titles).toContain(`The read-only deploy key on the repository ${baseInput().repoUrl}. It no longer works, so you can delete it there.`)
    expect(titles.some((title) => title.includes('docker volume ls --filter label=com.docker.compose.project=shop'))).toBe(true)
  })

  it('lists only the folder of a site without code', () => {
    const items = leftoversOf(record({ folder: { path: '/var/www/shop', createdByRun: true, placeholderSha256: 'a'.repeat(64) } }, { input: baseInput({ codeSource: 'none', template: 'static', database: null }) }))
    expect(items[0]).toMatchObject({ title: 'The site folder /var/www/shop', command: "sudo rm -rf '/var/www/shop'" })
  })
})

describe('leftoverSizesScript', () => {
  it('measures the folder and the database on the server', () => {
    const root = mkdtempSync(join(tmpdir(), 'leftovers'))
    try {
      const folder = join(root, 'shop')
      mkdirSync(`${folder}-deploy/shared`, { recursive: true })
      writeFileSync(`${folder}-deploy/shared/upload.bin`, Buffer.alloc(200_000))
      mkdirSync(join(root, 'bin'))
      writeFileSync(join(root, 'bin', 'mysql'), '#!/bin/sh\necho 12.5M\n', { mode: 0o755 })
      const run = record({ folder: { path: folder, createdByRun: true }, database: { engine: 'mysql', name: 'shop', user: 'shop' } })
      const result = spawnSync('/bin/sh', ['-s'], { input: leftoverSizesScript(run), encoding: 'utf8', env: { PATH: `${join(root, 'bin')}:/usr/bin:/bin` } })
      const sized = withSizes(leftoversOf(run), result.stdout)
      expect(sized[0].size).toMatch(/^\d+(\.\d+)?K$/)
      expect(sized[1].size).toBe('12.5M')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves the size unknown when it could not be measured', () => {
    const items = leftoversOf(record({ folder: { path: '/var/www/shop', createdByRun: true } }))
    expect(withSizes(items, 'folder\t\n')[0].size).toBeNull()
  })
})

describe('deletePreview', () => {
  it('says each removal happens only if nothing changed', () => {
    const run = record(
      { deploySite: 'shop', dnsRecords: [{ zoneId: 'z', recordId: 'r', name: 'shop.example.com', type: 'A' }], siteFile: { path: '/etc/nginx/sites-available/shop.conf', enabledLink: null, sha256: 'a'.repeat(64) }, certificate: { lineage: 'shop.example.com', issuedByRun: true } }
    )
    expect(deleteSteps(run, NGINX.driver).map(deletePreview)).toEqual([
      'Deploy site shop: automatic deploys stop, and its settings and deploy key on the server are deleted.',
      'DNS record A shop.example.com, if it still points at 203.0.113.10.',
      'nginx site /etc/nginx/sites-available/shop.conf, if unchanged. The web server keeps running.',
      'Certificate shop.example.com, if nothing else on the server uses it.'
    ])
  })
})
