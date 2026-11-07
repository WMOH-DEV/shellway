import type { SiteServer } from '@/types/createSite'
import { EXIT_NGINX_TEST, EXIT_REFUSED, EXIT_RELOAD } from '../ssl/originCa/scripts'
import { heredoc } from '../ssl/originCa/heredoc'
import type { WebServerDriver } from '../webServer/driver'
import { assertConf, assertFolder, assertModule, assertOwner, assertSha256, assertSiteName } from './validate'

export const ROOT_SHELL = 'sudo -n sh -s'

export interface SitePaths {
  file: string
  enabledLink: string | null
}

export interface SiteScriptInput {
  driver: WebServerDriver
  server: SiteServer
  siteName: string
}

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

function assertDriverMatches({ driver, server }: Pick<SiteScriptInput, 'driver' | 'server'>): void {
  if (driver.kind !== server.kind) throw new Error(`The ${driver.label} driver cannot manage an ${server.kind} site`)
}

export function sitePaths(server: SiteServer, siteName: string): SitePaths {
  const name = `${assertSiteName(siteName)}.conf`
  if (server.kind === 'nginx') return { file: `/etc/nginx/sites-available/${name}`, enabledLink: `/etc/nginx/sites-enabled/${name}` }
  if (server.layout === 'debian') return { file: `/etc/apache2/sites-available/${name}`, enabledLink: `/etc/apache2/sites-enabled/${name}` }
  return { file: `/etc/httpd/conf.d/${name}`, enabledLink: null }
}

function enableCommand(server: SiteServer, siteName: string, { file, enabledLink }: SitePaths): string | null {
  if (enabledLink === null) return null
  return server.kind === 'nginx' ? `ln -s ${quote(file)} ${quote(enabledLink)}` : `a2ensite ${quote(siteName)}`
}

function disableLines(server: SiteServer, siteName: string, { file, enabledLink }: SitePaths): string[] {
  if (enabledLink === null) return []
  if (server.kind === 'nginx') return [`if [ "$(readlink ${quote(enabledLink)})" = ${quote(file)} ]; then rm -f ${quote(enabledLink)}; fi`]
  return [`if [ -L ${quote(enabledLink)} ]; then a2dissite ${quote(siteName)}; fi`]
}

const refuseIfExists = (path: string): string[] => [
  `if [ -e ${quote(path)} ] || [ -L ${quote(path)} ]; then`,
  `  echo ${quote(`${path} already exists. Nothing was changed.`)} >&2`,
  `  exit ${EXIT_REFUSED}`,
  'fi'
]

const undoThenExit = (message: string, code: number, extra: string[] = []): string[] => [
  '  undo_site',
  ...extra.map((line) => `  ${line}`),
  `  echo ${quote(message)} >&2`,
  `  exit ${code}`,
  'fi'
]

export function createSiteScript({ driver, server, siteName, text }: SiteScriptInput & { text: string }): string {
  assertDriverMatches({ driver, server })
  const paths = sitePaths(server, siteName)
  const { file, enabledLink } = paths
  const enable = enableCommand(server, siteName, paths)
  return [
    'set -e',
    'umask 022',
    ...refuseIfExists(file),
    ...(enabledLink ? refuseIfExists(enabledLink) : []),
    'undo_site() {',
    ...disableLines(server, siteName, paths).map((line) => `  ${line}`),
    `  rm -f ${quote(file)}`,
    '}',
    `cat > ${quote(file)} ${heredoc(text).trimEnd()}`,
    ...(enable ? [`if ! ${enable}; then`, ...undoThenExit(`${driver.label} could not enable the site. It was removed.`, EXIT_NGINX_TEST)] : []),
    `if ! ${driver.testCommand}; then`,
    ...undoThenExit(`${driver.label} rejected the new site. It was removed.`, EXIT_NGINX_TEST),
    `if ! ${driver.reloadCommand}; then`,
    ...undoThenExit(`${driver.label} could not reload. The new site was removed.`, EXIT_RELOAD, [`${driver.reloadCommand} || true`]),
    ''
  ].join('\n')
}

export function removeSiteScript({ driver, server, siteName, sha256 }: SiteScriptInput & { sha256: string }): string {
  assertDriverMatches({ driver, server })
  const paths = sitePaths(server, siteName)
  const file = quote(paths.file)
  return [
    'set -e',
    `if [ -f ${file} ] && [ "$(sha256sum ${file} | cut -d' ' -f1)" != ${quote(assertSha256(sha256))} ]; then`,
    `  echo ${quote(`${paths.file} changed after Shellway wrote it. It was left in place.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    ...disableLines(server, siteName, paths),
    `rm -f ${file}`,
    driver.testCommand,
    driver.reloadCommand,
    ''
  ].join('\n')
}

export function enableModulesScript(server: SiteServer, missing: string[], confs: string[]): string | null {
  if (server.kind !== 'apache' || server.layout !== 'debian') return null
  const modules = missing.map(assertModule)
  const confNames = confs.map(assertConf)
  return [
    'set -e',
    ...(modules.length > 0 ? [`a2enmod ${modules.join(' ')}`] : []),
    ...(confNames.length > 0 ? [`a2enconf ${confNames.join(' ')}`] : []),
    ''
  ].join('\n')
}

export const FOLDER_CREATED = 'shellway: folder created'

export function folderScript(folder: string, owner: string): string {
  const root = quote(assertFolder(folder))
  const releases = quote(`${folder}/releases`)
  const shared = quote(`${folder}/shared`)
  return [
    'set -e',
    `if [ -e ${root} ] && [ ! -d ${root} ]; then`,
    `  echo ${quote(`${folder} exists and is not a folder. Nothing was changed.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `if [ -d ${root} ]; then`,
    `  if [ -n "$(ls -A ${root})" ]; then`,
    `    echo ${quote(`${folder} already has files in it. Nothing was changed.`)} >&2`,
    `    exit ${EXIT_REFUSED}`,
    '  fi',
    'else',
    `  mkdir -p ${root}`,
    `  echo ${quote(FOLDER_CREATED)}`,
    'fi',
    `mkdir ${releases} ${shared}`,
    `chown ${quote(`${assertOwner(owner)}:`)} ${root} ${releases} ${shared}`,
    ''
  ].join('\n')
}

export function removeFolderScript(folder: string): string {
  const root = quote(assertFolder(folder))
  return [
    'set -e',
    `for dir in ${quote(`${folder}/releases`)} ${quote(`${folder}/shared`)}; do`,
    '  if [ -d "$dir" ] && ! rmdir "$dir"; then',
    `    echo "$dir has files in it. ${folder} was left in place." >&2`,
    `    exit ${EXIT_REFUSED}`,
    '  fi',
    'done',
    `if ! rmdir ${root}; then`,
    `  echo ${quote(`${folder} has files in it. It was left in place.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    ''
  ].join('\n')
}
