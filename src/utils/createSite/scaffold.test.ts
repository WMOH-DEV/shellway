import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { laravelScaffoldScript, localProjectPath, placeholderPage, scaffoldFiles } from './scaffold'

const FACTS = { template: 'node' as const, siteName: 'shop', domain: 'shop.example.com', appPort: 3000 }

describe('scaffoldFiles', () => {
  it('starts a Node.js app with a lock file npm ci accepts, listening only on this server', () => {
    const files = scaffoldFiles(FACTS)
    expect(Object.keys(files).sort()).toEqual(['.gitignore', 'package-lock.json', 'package.json', 'server.js'])
    expect(JSON.parse(files['package-lock.json'])).toMatchObject({ name: 'shop', lockfileVersion: 3 })
    expect(files['server.js']).toContain("const port = Number(process.env.PORT) || 3000")
    expect(files['server.js']).toContain(".listen(port, '127.0.0.1')")
  })

  it('starts a PHP site and a static site with one page each', () => {
    expect(Object.keys(scaffoldFiles({ ...FACTS, template: 'php' })).sort()).toEqual(['.gitignore', 'composer.json', 'index.php'])
    expect(scaffoldFiles({ ...FACTS, template: 'static' })['index.html']).toContain('<title>shop.example.com</title>')
  })

  it('refuses stacks it cannot start on this PC', () => {
    expect(() => scaffoldFiles({ ...FACTS, template: 'laravel' })).toThrow('cannot start a new laravel project')
    expect(() => scaffoldFiles({ ...FACTS, template: 'compose' })).toThrow('cannot start a new compose project')
  })

  it('escapes the folder in the placeholder page', () => {
    expect(placeholderPage('shop.example.com', '/var/www/<shop>')).toContain('/var/www/&lt;shop&gt;')
  })
})

describe('laravelScaffoldScript', () => {
  const script = laravelScaffoldScript({ phpVersion: '8.3', server: { kind: 'nginx' } })

  it('makes the project in a temporary folder that is always removed, and never runs composer scripts', () => {
    expect(script).toContain('work=$(mktemp -d "$HOME/.shellway-new-XXXXXX")')
    expect(script).toContain(`trap 'rm -rf "$work"' EXIT`)
    expect(script).toContain('create-project laravel/laravel app --no-scripts')
    expect(spawnSync('sh', ['-n'], { input: script }).status).toBe(0)
  })

  it('sends the project as a plain archive without vendor or .env', () => {
    expect(script).toContain('--exclude=./vendor')
    expect(script).toContain('--exclude=./.env ')
    expect(script).toMatch(/tar -C app --format=ustar .* -czf - \. \| base64/)
  })
})

describe('localProjectPath', () => {
  it('puts the project in a folder named after the site', () => {
    expect(localProjectPath('/home/dev/Projects/', 'shop')).toBe('/home/dev/Projects/shop')
    expect(localProjectPath('C:\\Users\\dev\\Projects', 'shop')).toBe('C:\\Users\\dev\\Projects\\shop')
    expect(() => localProjectPath('/home/dev', '../evil')).toThrow()
  })
})
