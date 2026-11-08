import { describe, expect, it } from 'vitest'
import type { RepoFiles } from '@/types/createSite'
import { phpMinimum, phpVersionFor, suggestStack } from './repoSuggest'

const repo = (files: string[], extra: Partial<RepoFiles> = {}): RepoFiles => ({ files, packageJson: null, composerJson: null, envExample: null, ...extra })
const pkg = (json: object): string => JSON.stringify(json)

describe('suggestStack', () => {
  it('reads Laravel from artisan, with the PHP it asks for, its npm build and its .env.example', () => {
    const suggestion = suggestStack(repo(['artisan', 'composer.json', 'package.json'], {
      composerJson: pkg({ require: { php: '^8.2', 'laravel/framework': '^11.0' } }),
      packageJson: pkg({ scripts: { build: 'vite build', dev: 'vite' }, devDependencies: { vite: '^5' } }),
      envExample: 'APP_NAME=Laravel\n'
    }))
    expect(suggestion).toEqual({ template: 'laravel', reason: 'It has an artisan file.', phpMinimum: '8.2', buildScript: true, outputDir: null, envExample: 'APP_NAME=Laravel\n' })
  })

  it('reads Docker Compose before anything in package.json', () => {
    expect(suggestStack(repo(['compose.yaml', 'package.json'], { packageJson: pkg({ scripts: { start: 'node .' } }) })).template).toBe('compose')
  })

  it('serves a Vite or Create React App build as a static site from its output folder', () => {
    expect(suggestStack(repo(['package.json', 'index.html'], { packageJson: pkg({ scripts: { build: 'vite build' }, devDependencies: { vite: '^5' } }) })))
      .toMatchObject({ template: 'static', outputDir: 'dist', reason: 'It builds with vite and has no start script.' })
    expect(suggestStack(repo(['package.json'], { packageJson: pkg({ scripts: { build: 'react-scripts build' }, dependencies: { 'react-scripts': '5' } }) })))
      .toMatchObject({ template: 'static', outputDir: 'build' })
  })

  it('runs an app with a start script as Node.js, even when it also builds with Vite', () => {
    const next = pkg({ scripts: { build: 'vite build', start: 'node server.js' }, devDependencies: { vite: '^5' } })
    expect(suggestStack(repo(['package.json'], { packageJson: next }))).toMatchObject({ template: 'node', outputDir: null, buildScript: true })
  })

  it('falls back to PHP for composer.json and to a static site for index.html', () => {
    expect(suggestStack(repo(['composer.json', 'index.php'])).template).toBe('php')
    expect(suggestStack(repo(['index.html', 'style.css'])).template).toBe('static')
  })

  it('suggests nothing it cannot back up', () => {
    expect(suggestStack(repo(['README.md']))).toMatchObject({ template: null, reason: 'None of the files Shellway looks for are there.' })
    expect(suggestStack(repo(['package.json'], { packageJson: '{ not json' })).template).toBeNull()
    expect(suggestStack(repo(['package.json'], { packageJson: pkg({ scripts: ['start'] }) })).template).toBeNull()
  })
})

describe('phpMinimum', () => {
  it.each([
    ['^8.2', '8.2'],
    ['>=8.1 <9', '8.1'],
    ['~8.3.0', '8.3'],
    ['8.*', null]
  ])('%s needs %s', (constraint, minimum) => {
    expect(phpMinimum(pkg({ require: { php: constraint } }))).toBe(minimum)
  })

  it('is unknown without a php requirement', () => {
    expect(phpMinimum(pkg({ require: {} }))).toBeNull()
    expect(phpMinimum(null)).toBeNull()
  })
})

describe('phpVersionFor', () => {
  const php = { installed: ['8.3', '8.1'], installable: ['8.4'], missingPackages: {}, drivers: {} }

  it('picks the newest installed version that is new enough, then one that can be installed', () => {
    expect(phpVersionFor(php, '8.2')).toBe('8.3')
    expect(phpVersionFor(php, '8.4')).toBe('8.4')
    expect(phpVersionFor(php, '9.0')).toBeNull()
    expect(phpVersionFor(php, null)).toBeNull()
  })
})
