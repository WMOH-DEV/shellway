import type { CreateSiteInput, TemplateId } from '@/types/createSite'
import { pinPhpVersion } from './php'
import { assertDomain, assertPort, assertSiteName } from './validate'

export type ScaffoldFiles = Record<string, string>

type ScaffoldFacts = Pick<CreateSiteInput, 'template' | 'siteName' | 'domain' | 'appPort'>

export const NEW_PROJECT_TEMPLATES: readonly TemplateId[] = ['laravel', 'php', 'node', 'static']

export const NO_CODE_TEMPLATES: readonly TemplateId[] = ['static', 'php']

export const githubSshUrlOf = (owner: string, name: string): string => `git@github.com:${owner}/${name}.git`

export const scaffoldsOnServer = (template: TemplateId): boolean => template === 'laravel'

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function page(domain: string, body: string): string {
  const name = escapeHtml(assertDomain(domain))
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${name}</title>`,
    '</head>',
    '<body>',
    `  <h1>${name}</h1>`,
    `  <p>${body}</p>`,
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

export const placeholderPage = (domain: string, folder: string): string =>
  page(domain, `This site is ready. Put its files in ${escapeHtml(folder)} on the server.`)

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

function nodeFiles({ siteName, domain, appPort }: ScaffoldFacts): ScaffoldFiles {
  const name = assertSiteName(siteName)
  const engines = { node: '>=18' }
  const html = page(domain, 'Your Node.js app is running.')
  return {
    'package.json': json({ name, version: '1.0.0', private: true, scripts: { start: 'node server.js' }, engines }),
    'package-lock.json': json({ name, version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name, version: '1.0.0', engines } } }),
    'server.js': [
      "const http = require('node:http')",
      '',
      `const port = Number(process.env.PORT) || ${assertPort(appPort)}`,
      `const page = ${JSON.stringify(html)}`,
      '',
      'http',
      "  .createServer((request, response) => {",
      "    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })",
      '    response.end(page)',
      '  })',
      "  .listen(port, '127.0.0.1')",
      ''
    ].join('\n'),
    '.gitignore': 'node_modules/\n.env\n'
  }
}

function phpFiles({ domain }: ScaffoldFacts): ScaffoldFiles {
  return {
    'index.php': page(domain, 'Your PHP site is running on PHP <?= PHP_VERSION ?>.'),
    'composer.json': json({ require: { php: '>=8.1' } }),
    '.gitignore': '/vendor/\n.env\n'
  }
}

const staticFiles = ({ domain }: ScaffoldFacts): ScaffoldFiles => ({ 'index.html': page(domain, 'Your site is live.') })

export function scaffoldFiles(facts: ScaffoldFacts): ScaffoldFiles {
  switch (facts.template) {
    case 'node': return nodeFiles(facts)
    case 'php': return phpFiles(facts)
    case 'static': return staticFiles(facts)
    default: throw new Error(`Shellway cannot start a new ${facts.template} project on this PC`)
  }
}

const TAR_EXCLUDES = ['./vendor', './node_modules', './.env', './database/database.sqlite'].map((path) => `--exclude=${path}`).join(' ')

const isRhel = ({ server }: Pick<CreateSiteInput, 'server'>): boolean => server.kind === 'apache' && server.layout === 'rhel'

export function laravelScaffoldScript(facts: Pick<CreateSiteInput, 'phpVersion' | 'server'>): string {
  const create = 'composer create-project laravel/laravel app --no-scripts --prefer-dist --no-progress --no-interaction'
  return [
    'set -e',
    'work=$(mktemp -d "$HOME/.shellway-new-XXXXXX")',
    "trap 'rm -rf \"$work\"' EXIT",
    'cd "$work"',
    `${isRhel(facts) ? create : pinPhpVersion(create, facts.phpVersion)} 1>&2`,
    `tar -C app --format=ustar ${TAR_EXCLUDES} -czf - . | base64`,
    ''
  ].join('\n')
}

export function localProjectPath(parent: string, siteName: string): string {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return `${parent.replace(/[\\/]+$/, '')}${separator}${assertSiteName(siteName)}`
}
