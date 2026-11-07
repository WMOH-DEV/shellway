import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SiteServer } from '@/types/createSite'
import type { WebServerDriver } from '../webServer/driver'
import {
  FOLDER_CREATED,
  createSiteScript,
  enableModulesScript,
  folderScript,
  removeFolderScript,
  removeSiteScript,
  sitePaths
} from './siteScripts'
import { APACHE_DEBIAN, APACHE_RHEL, NGINX, SERVER_CASES, type ServerCase } from './testFixtures'

const TEXT = 'server {\n    listen 80;\n}\n'
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
const syntaxOk = (script: string) => expect(spawnSync('sh', ['-n'], { input: script }).status).toBe(0)
const linkExists = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'createsite-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

interface Sandbox {
  file: string
  link: string | null
  run: (script: string) => { status: number | null; stdout: string; stderr: string; reloads: number }
}

function sandbox({ server }: ServerCase, testExit = 0, reloadExit = 0): Sandbox {
  for (const dir of ['nginx/sites-available', 'nginx/sites-enabled', 'apache2/sites-available', 'apache2/sites-enabled', 'httpd/conf.d']) {
    mkdirSync(join(root, dir), { recursive: true })
  }
  const relocate = (text: string) => text.replaceAll('/etc/', `${root}/`)
  const { file, enabledLink } = sitePaths(server, 'shop')
  const prelude = [
    `site_test() { return ${testExit}; }`,
    `site_reload() { echo x >> '${root}/reloads'; return ${reloadExit}; }`,
    `a2ensite() { ln -s "${root}/apache2/sites-available/$1.conf" "${root}/apache2/sites-enabled/$1.conf"; }`,
    `a2dissite() { rm -f "${root}/apache2/sites-enabled/$1.conf"; }`,
    ''
  ].join('\n')
  return {
    file: relocate(file),
    link: enabledLink === null ? null : relocate(enabledLink),
    run(script) {
      const result = spawnSync('sh', ['-s'], { input: prelude + relocate(script), encoding: 'utf8' })
      const reloads = existsSync(join(root, 'reloads')) ? readFileSync(join(root, 'reloads'), 'utf8').trim().split('\n').length : 0
      return { status: result.status, stdout: result.stdout, stderr: result.stderr, reloads }
    }
  }
}

const fakeCommands = (driver: WebServerDriver): WebServerDriver => ({ ...driver, testCommand: 'site_test', reloadCommand: 'site_reload' })
const create = (c: ServerCase, text = TEXT) => createSiteScript({ driver: fakeCommands(c.driver), server: c.server, siteName: 'shop', text })
const remove = (c: ServerCase, sha: string) => removeSiteScript({ driver: fakeCommands(c.driver), server: c.server, siteName: 'shop', sha256: sha })

describe('sitePaths', () => {
  it.each([
    [{ kind: 'nginx' }, '/etc/nginx/sites-available/shop.conf', '/etc/nginx/sites-enabled/shop.conf'],
    [{ kind: 'apache', layout: 'debian' }, '/etc/apache2/sites-available/shop.conf', '/etc/apache2/sites-enabled/shop.conf'],
    [{ kind: 'apache', layout: 'rhel' }, '/etc/httpd/conf.d/shop.conf', null]
  ] as Array<[SiteServer, string, string | null]>)('%j', (server, file, enabledLink) => {
    expect(sitePaths(server, 'shop')).toEqual({ file, enabledLink })
  })

  it.each(['../shop', 'shop/x', 'shop\nx', "shop'", ''])('refuses the site name %j', (name) => {
    expect(() => sitePaths({ kind: 'nginx' }, name)).toThrow('is not a valid site name')
  })
})

describe('createSiteScript', () => {
  it('nginx: refuses, writes, links, tests and rolls back with the exact lines', () => {
    const script = createSiteScript({ driver: NGINX.driver, server: NGINX.server, siteName: 'shop', text: TEXT })
    const token = /<<'(SHELLWAY_[0-9a-f]{32})'/.exec(script)?.[1] ?? ''
    expect(script).toBe([
      'set -e',
      'umask 022',
      "if [ -e '/etc/nginx/sites-available/shop.conf' ] || [ -L '/etc/nginx/sites-available/shop.conf' ]; then",
      "  echo '/etc/nginx/sites-available/shop.conf already exists. Nothing was changed.' >&2",
      '  exit 3',
      'fi',
      "if [ -e '/etc/nginx/sites-enabled/shop.conf' ] || [ -L '/etc/nginx/sites-enabled/shop.conf' ]; then",
      "  echo '/etc/nginx/sites-enabled/shop.conf already exists. Nothing was changed.' >&2",
      '  exit 3',
      'fi',
      'undo_site() {',
      `  if [ "$(readlink '/etc/nginx/sites-enabled/shop.conf')" = '/etc/nginx/sites-available/shop.conf' ]; then rm -f '/etc/nginx/sites-enabled/shop.conf'; fi`,
      "  rm -f '/etc/nginx/sites-available/shop.conf'",
      '}',
      `cat > '/etc/nginx/sites-available/shop.conf' <<'${token}'`,
      'server {',
      '    listen 80;',
      '}',
      token,
      "if ! ln -s '/etc/nginx/sites-available/shop.conf' '/etc/nginx/sites-enabled/shop.conf'; then",
      '  undo_site',
      "  echo 'nginx could not enable the site. It was removed.' >&2",
      '  exit 4',
      'fi',
      'if ! nginx -t; then',
      '  undo_site',
      "  echo 'nginx rejected the new site. It was removed.' >&2",
      '  exit 4',
      'fi',
      'if ! nginx -s reload; then',
      '  undo_site',
      '  nginx -s reload || true',
      "  echo 'nginx could not reload. The new site was removed.' >&2",
      '  exit 5',
      'fi',
      ''
    ].join('\n'))
  })

  it('Debian Apache enables with a2ensite and disables with a2dissite', () => {
    const script = createSiteScript({ driver: APACHE_DEBIAN.driver, server: APACHE_DEBIAN.server, siteName: 'shop', text: TEXT })
    expect(script).toContain("if ! a2ensite 'shop'; then")
    expect(script).toContain("  if [ -L '/etc/apache2/sites-enabled/shop.conf' ]; then a2dissite 'shop'; fi")
    expect(script).toContain('if ! apache2ctl configtest; then')
    expect(script).toContain('if ! systemctl reload apache2; then')
  })

  it('RHEL Apache only writes into conf.d', () => {
    const script = createSiteScript({ driver: APACHE_RHEL.driver, server: APACHE_RHEL.server, siteName: 'shop', text: TEXT })
    expect(script).toContain("cat > '/etc/httpd/conf.d/shop.conf'")
    expect(script).not.toMatch(/a2ensite|a2dissite|ln -s|sites-enabled/)
    expect(script).toContain("undo_site() {\n  rm -f '/etc/httpd/conf.d/shop.conf'\n}")
  })

  it.each(SERVER_CASES)('$name: is valid shell and never deletes recursively', (c) => {
    const script = create(c)
    syntaxOk(script)
    expect(script).not.toContain('rm -r')
  })

  it('refuses a driver for another web server', () => {
    expect(() => createSiteScript({ driver: NGINX.driver, server: APACHE_DEBIAN.server, siteName: 'shop', text: TEXT })).toThrow('cannot manage')
  })

  describe.each(SERVER_CASES)('$name run', (c) => {
    it('writes the file, enables it and reloads once', () => {
      const box = sandbox(c)
      const result = box.run(create(c))
      expect(result.status).toBe(0)
      expect(readFileSync(box.file, 'utf8')).toBe(TEXT)
      if (box.link) expect(readlinkSync(box.link)).toBe(box.file)
      expect(result.reloads).toBe(1)
    })

    it('refuses with exit 3 and leaves an existing file alone', () => {
      const box = sandbox(c)
      writeFileSync(box.file, 'theirs\n')
      const result = box.run(create(c))
      expect(result.status).toBe(3)
      expect(result.stderr).toContain('already exists. Nothing was changed.')
      expect(readFileSync(box.file, 'utf8')).toBe('theirs\n')
      if (box.link) expect(linkExists(box.link)).toBe(false)
      expect(result.reloads).toBe(0)
    })

    it('removes the new site with exit 4 when the config test fails', () => {
      const box = sandbox(c, 1)
      const result = box.run(create(c))
      expect(result.status).toBe(4)
      expect(existsSync(box.file)).toBe(false)
      if (box.link) expect(linkExists(box.link)).toBe(false)
      expect(result.reloads).toBe(0)
    })

    it('removes the new site and reloads again with exit 5 when the reload fails', () => {
      const box = sandbox(c, 0, 1)
      const result = box.run(create(c))
      expect(result.status).toBe(5)
      expect(existsSync(box.file)).toBe(false)
      if (box.link) expect(linkExists(box.link)).toBe(false)
      expect(result.reloads).toBe(2)
    })
  })

  it('nginx: refuses with exit 3 when the enabled link already exists', () => {
    const box = sandbox(NGINX)
    symlinkSync('/nowhere', box.link ?? '')
    const result = box.run(create(NGINX))
    expect(result.status).toBe(3)
    expect(existsSync(box.file)).toBe(false)
    expect(readlinkSync(box.link ?? '')).toBe('/nowhere')
  })
})

describe('removeSiteScript', () => {
  it('nginx: refuses a changed file, then unlinks, removes, tests and reloads', () => {
    expect(remove(NGINX, sha256(TEXT)).split('\n')).toEqual([
      'set -e',
      `if [ -f '/etc/nginx/sites-available/shop.conf' ] && [ "$(sha256sum '/etc/nginx/sites-available/shop.conf' | cut -d' ' -f1)" != '${sha256(TEXT)}' ]; then`,
      "  echo '/etc/nginx/sites-available/shop.conf changed after Shellway wrote it. It was left in place.' >&2",
      '  exit 3',
      'fi',
      `if [ "$(readlink '/etc/nginx/sites-enabled/shop.conf')" = '/etc/nginx/sites-available/shop.conf' ]; then rm -f '/etc/nginx/sites-enabled/shop.conf'; fi`,
      "rm -f '/etc/nginx/sites-available/shop.conf'",
      'site_test',
      'site_reload',
      ''
    ])
  })

  it.each(['', 'abc', 'A'.repeat(64), `${'a'.repeat(64)}'; rm -rf /`])('refuses the checksum %j', (sha) => {
    expect(() => remove(NGINX, sha)).toThrow('is not a sha256 checksum')
  })

  describe.each(SERVER_CASES)('$name run', (c) => {
    const install = (box: Sandbox, text: string) => {
      writeFileSync(box.file, text)
      if (box.link) symlinkSync(box.file, box.link)
    }

    it('removes the file and its link when it is unchanged', () => {
      const box = sandbox(c)
      install(box, TEXT)
      const result = box.run(remove(c, sha256(TEXT)))
      expect(result.status).toBe(0)
      expect(existsSync(box.file)).toBe(false)
      if (box.link) expect(linkExists(box.link)).toBe(false)
      expect(result.reloads).toBe(1)
    })

    it('leaves a file that changed since the run wrote it', () => {
      const box = sandbox(c)
      install(box, `${TEXT}# edited\n`)
      const result = box.run(remove(c, sha256(TEXT)))
      expect(result.status).toBe(3)
      expect(readFileSync(box.file, 'utf8')).toBe(`${TEXT}# edited\n`)
      if (box.link) expect(linkExists(box.link)).toBe(true)
      expect(result.reloads).toBe(0)
    })
  })

  it('nginx: keeps an enabled link that points somewhere else', () => {
    const box = sandbox(NGINX)
    writeFileSync(box.file, TEXT)
    symlinkSync('/etc/nginx/sites-available/other.conf', box.link ?? '')
    expect(box.run(remove(NGINX, sha256(TEXT))).status).toBe(0)
    expect(readlinkSync(box.link ?? '')).toBe('/etc/nginx/sites-available/other.conf')
  })
})

describe('enableModulesScript', () => {
  it('enables only the given modules and confs on Debian', () => {
    expect(enableModulesScript(APACHE_DEBIAN.server, ['rewrite', 'proxy_fcgi', 'setenvif'], ['php8.3-fpm'])).toBe(
      'set -e\na2enmod rewrite proxy_fcgi setenvif\na2enconf php8.3-fpm\n'
    )
    expect(enableModulesScript(APACHE_DEBIAN.server, ['proxy_http'], [])).toBe('set -e\na2enmod proxy_http\n')
  })

  it('never disables anything', () => {
    expect(enableModulesScript(APACHE_DEBIAN.server, ['rewrite'], ['php8.3-fpm'])).not.toMatch(/a2dis/)
  })

  it('returns nothing for RHEL and nginx', () => {
    expect(enableModulesScript(APACHE_RHEL.server, ['rewrite'], [])).toBeNull()
    expect(enableModulesScript(NGINX.server, ['rewrite'], [])).toBeNull()
  })

  it.each([[['rewrite; rm -rf /'], []], [['rewrite\nid'], []], [[], ['php8.3-fpm; id']], [[], ['../php']]])('refuses %j %j', (modules, confs) => {
    expect(() => enableModulesScript(APACHE_DEBIAN.server, modules, confs)).toThrow(/is not a valid Apache/)
  })
})

describe('folderScript', () => {
  const owner = userInfo().username
  const runAsIs = (script: string) => spawnSync('sh', ['-s'], { input: script, encoding: 'utf8' })

  it('has the exact refuse and create lines', () => {
    expect(folderScript('/var/www/shop', 'deploy').split('\n')).toEqual([
      'set -e',
      "if [ -e '/var/www/shop' ] || [ -L '/var/www/shop' ]; then",
      "  echo '/var/www/shop already exists. Nothing was changed.' >&2",
      '  exit 3',
      'fi',
      "if [ -e '/var/www/shop-deploy' ] || [ -L '/var/www/shop-deploy' ]; then",
      "  echo '/var/www/shop-deploy already exists. Nothing was changed.' >&2",
      '  exit 3',
      'fi',
      `mkdir -p "$(dirname '/var/www/shop')"`,
      "mkdir '/var/www/shop-deploy' '/var/www/shop-deploy/releases' '/var/www/shop-deploy/shared'",
      `echo '${FOLDER_CREATED}'`,
      "chown -R 'deploy:' '/var/www/shop-deploy'",
      "ln -s '/var/www/shop-deploy/current' '/var/www/shop'",
      ''
    ])
  })

  it.each([['/var/www/shop; rm -rf /', 'deploy'], ['/var/www/../etc', 'deploy'], ['/var/www/shop', 'deploy; id'], ['/var/www/shop', 'Deploy\n']])(
    'refuses %j owned by %j',
    (folder, user) => {
      expect(() => folderScript(folder, user)).toThrow(/is not a valid/)
    }
  )

  it('lays out the folder the way the Deploy runner expects', () => {
    const folder = join(root, 'shop')
    const result = runAsIs(folderScript(folder, owner))
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(FOLDER_CREATED)
    expect(readlinkSync(folder)).toBe(`${folder}-deploy/current`)
    expect(existsSync(`${folder}-deploy/releases`) && existsSync(`${folder}-deploy/shared`)).toBe(true)
  })

  it.each([
    ['an empty folder', () => mkdirSync(join(root, 'shop'))],
    ['a file', () => writeFileSync(join(root, 'shop'), 'hi')],
    ['a dangling symlink', () => symlinkSync(join(root, 'elsewhere'), join(root, 'shop'))],
    ['a deploy folder', () => mkdirSync(join(root, 'shop-deploy'))]
  ])('refuses when the path is already %s and changes nothing', (_name, prepare) => {
    prepare()
    const result = runAsIs(folderScript(join(root, 'shop'), owner))
    expect(result.status).toBe(3)
    expect(result.stdout).not.toContain(FOLDER_CREATED)
    expect(existsSync(join(root, 'shop-deploy/releases'))).toBe(false)
  })
})

describe('removeFolderScript', () => {
  const owner = userInfo().username
  const runAsIs = (script: string) => spawnSync('sh', ['-s'], { input: script, encoding: 'utf8' })
  const created = () => {
    const folder = join(root, 'shop')
    runAsIs(folderScript(folder, owner))
    return folder
  }

  it('never deletes recursively', () => {
    const script = removeFolderScript('/var/www/shop')
    expect(script).not.toMatch(/rm -r|rm -fr|rm -rf/)
    expect(script).toContain("if [ -L '/var/www/shop' ] && [ \"$(readlink '/var/www/shop')\" = '/var/www/shop-deploy/current' ]; then rm -f '/var/www/shop'; fi")
    syntaxOk(script)
  })

  it('removes what the run created when nothing was deployed', () => {
    const folder = created()
    expect(runAsIs(removeFolderScript(folder)).status).toBe(0)
    expect(existsSync(`${folder}-deploy`)).toBe(false)
    expect(() => lstatSync(folder)).toThrow()
  })

  it('keeps everything once a release was deployed', () => {
    const folder = created()
    mkdirSync(`${folder}-deploy/releases/1`)
    symlinkSync(`${folder}-deploy/releases/1`, `${folder}-deploy/current`)
    const result = runAsIs(removeFolderScript(folder))
    expect(result.status).toBe(3)
    expect(existsSync(`${folder}-deploy/releases/1`)).toBe(true)
    expect(readlinkSync(folder)).toBe(`${folder}-deploy/current`)
  })

  it('keeps the deploy folder when something else was put in it', () => {
    const folder = created()
    writeFileSync(`${folder}-deploy/notes.txt`, 'keep')
    expect(runAsIs(removeFolderScript(folder)).status).toBe(3)
    expect(readFileSync(`${folder}-deploy/notes.txt`, 'utf8')).toBe('keep')
  })

  it('leaves a site path that points somewhere else', () => {
    const folder = created()
    rmSync(folder)
    symlinkSync(join(root, 'elsewhere'), folder)
    expect(runAsIs(removeFolderScript(folder)).status).toBe(0)
    expect(readlinkSync(folder)).toBe(join(root, 'elsewhere'))
  })
})
