import type { SiteServer } from '@/types/createSite'
import { EXIT_NGINX_TEST, EXIT_REFUSED, EXIT_RELOAD } from '../ssl/originCa/exitCodes'
import { heredoc } from '../ssl/originCa/heredoc'
import type { WebServerDriver } from '../webServer/driver'
import { assertConf, assertFolder, assertLineage, assertModule, assertOwner, assertSha256, assertSiteName } from './validate'

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

function enabledCheck(server: SiteServer, { file, enabledLink }: SitePaths): string | null {
  if (enabledLink === null) return null
  return server.kind === 'nginx' ? `[ "$(readlink ${quote(enabledLink)})" = ${quote(file)} ]` : `[ -L ${quote(enabledLink)} ]`
}

export function removeSiteScript({ driver, server, siteName, sha256 }: SiteScriptInput & { sha256: string }): string {
  assertDriverMatches({ driver, server })
  const paths = sitePaths(server, siteName)
  const file = quote(paths.file)
  const enabled = enabledCheck(server, paths)
  const enable = enableCommand(server, siteName, paths)
  return [
    'set -e',
    `if [ -f ${file} ] && [ "$(sha256sum ${file} | cut -d' ' -f1)" != ${quote(assertSha256(sha256))} ]; then`,
    `  echo ${quote(`${paths.file} changed after Shellway wrote it. It was left in place.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    'keep=$(mktemp -d)',
    'had_file=0',
    `if [ -f ${file} ]; then cp -p ${file} "$keep/site.conf"; had_file=1; fi`,
    'was_enabled=0',
    ...(enabled ? [`if ${enabled}; then was_enabled=1; fi`] : []),
    ...disableLines(server, siteName, paths),
    `rm -f ${file}`,
    `if ! ${driver.testCommand}; then`,
    `  if [ "$had_file" = 1 ]; then cp -p "$keep/site.conf" ${file}; fi`,
    ...(enable ? [`  if [ "$was_enabled" = 1 ]; then ${enable}; fi`] : []),
    '  rm -f "$keep/site.conf"; rmdir "$keep"',
    `  echo ${quote(`${driver.label} rejected the configuration without this site, so ${paths.file} was put back.`)} >&2`,
    `  exit ${EXIT_NGINX_TEST}`,
    'fi',
    'rm -f "$keep/site.conf"; rmdir "$keep"',
    driver.reloadCommand,
    ''
  ].join('\n')
}

function notYetEnabled(variable: string, names: string[], enabledPath: (name: string) => string): string[] {
  if (names.length === 0) return [`${variable}=''`]
  return [`${variable}=''`, `for n in ${names.join(' ')}; do [ -e "${enabledPath('$n')}" ] || ${variable}="$${variable} $n"; done`]
}

export function enableModulesScript(server: SiteServer, missing: string[], confs: string[]): string | null {
  if (server.kind !== 'apache' || server.layout !== 'debian') return null
  const modules = missing.map(assertModule)
  const confNames = confs.map(assertConf)
  return [
    'set -e',
    ...notYetEnabled('new_mods', modules, (name) => `/etc/apache2/mods-enabled/${name}.load`),
    ...notYetEnabled('new_confs', confNames, (name) => `/etc/apache2/conf-enabled/${name}.conf`),
    'turn_off_new() {',
    '  for n in $new_mods; do a2dismod -f "$n" || true; done',
    '  for n in $new_confs; do a2disconf "$n" || true; done',
    '}',
    'if ! { [ -z "$new_mods" ] || a2enmod $new_mods; } || ! { [ -z "$new_confs" ] || a2enconf $new_confs; } || ! apache2ctl configtest; then',
    '  turn_off_new',
    "  echo 'Apache could not turn these on or rejected the configuration with them, so the ones just turned on were turned off again.' >&2",
    `  exit ${EXIT_NGINX_TEST}`,
    'fi',
    ''
  ].join('\n')
}

export const FOLDER_CREATED = 'shellway: folder created'

export const deployRootOf = (folder: string): string => `${assertFolder(folder)}-deploy`

export function folderScript(folder: string, owner: string): string {
  const site = quote(assertFolder(folder))
  const deployRoot = quote(deployRootOf(folder))
  const current = quote(`${deployRootOf(folder)}/current`)
  const user = quote(`${assertOwner(owner)}:`)
  return [
    'set -e',
    `if [ -e ${site} ] || [ -L ${site} ]; then`,
    `  echo ${quote(`${folder} already exists. Nothing was changed.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `if [ -e ${deployRoot} ] || [ -L ${deployRoot} ]; then`,
    `  echo ${quote(`${deployRootOf(folder)} already exists. Nothing was changed.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `mkdir -p "$(dirname ${site})"`,
    `mkdir ${deployRoot} ${quote(`${deployRootOf(folder)}/releases`)} ${quote(`${deployRootOf(folder)}/shared`)}`,
    `echo ${quote(FOLDER_CREATED)}`,
    `chown -R ${user} ${deployRoot}`,
    `ln -s ${current} ${site}`,
    ''
  ].join('\n')
}

export function removeFolderScript(folder: string): string {
  const site = quote(assertFolder(folder))
  const deployRoot = quote(deployRootOf(folder))
  const current = quote(`${deployRootOf(folder)}/current`)
  return [
    'set -e',
    `for dir in ${quote(`${deployRootOf(folder)}/releases`)} ${quote(`${deployRootOf(folder)}/shared`)}; do`,
    '  if [ -d "$dir" ] && ! rmdir "$dir"; then',
    `    echo "$dir has files in it. ${deployRootOf(folder)} was left in place." >&2`,
    `    exit ${EXIT_REFUSED}`,
    '  fi',
    'done',
    `if [ -L ${current} ] || [ -e ${current} ]; then`,
    `  echo ${quote(`${deployRootOf(folder)} has a deployed release. It was left in place.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `if [ -d ${deployRoot} ] && ! rmdir ${deployRoot}; then`,
    `  echo ${quote(`${deployRootOf(folder)} has files in it. It was left in place.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `if [ -L ${site} ] && [ "$(readlink ${site})" = ${current} ]; then rm -f ${site}; fi`,
    ''
  ].join('\n')
}

export function removeEnvFileScript(path: string, sha256: string): string {
  const file = quote(path)
  return [
    'set -e',
    `if [ ! -f ${file} ]; then echo ${quote(`${path} is already gone.`)}; exit 0; fi`,
    `if [ "$(sha256sum ${file} | cut -d' ' -f1)" != ${quote(assertSha256(sha256))} ]; then`,
    `  echo ${quote(`${path} changed after Shellway wrote it. It was left in place.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `rm -f ${file}`,
    ''
  ].join('\n')
}

export const WEB_SERVER_CONFIG_DIRS = ['/etc/nginx', '/etc/apache2', '/etc/httpd']

export function removeCertificateScript(lineage: string): string {
  const name = assertLineage(lineage)
  const live = quote(`/etc/letsencrypt/live/${name}/`)
  return [
    'set -e',
    `if [ ! -e ${quote(`/etc/letsencrypt/renewal/${name}.conf`)} ] && [ ! -e ${quote(`/etc/letsencrypt/live/${name}`)} ]; then`,
    `  echo ${quote(`The certificate ${name} is already gone.`)}`,
    '  exit 0',
    'fi',
    `used=$(grep -RlsF ${live} ${WEB_SERVER_CONFIG_DIRS.join(' ')} || true)`,
    'loaded=""',
    `if command -v nginx >/dev/null 2>&1 && nginx -T 2>/dev/null | grep -qF ${live}; then loaded="nginx -T"; fi`,
    'for ctl in apache2ctl apachectl; do',
    '  command -v "$ctl" >/dev/null 2>&1 || continue',
    `  for f in $("$ctl" -t -D DUMP_INCLUDES 2>/dev/null | awk 'substr($NF, 1, 1) == "/" {print $NF}'); do`,
    `    if grep -qsF ${live} "$f"; then loaded="$loaded $f"; fi`,
    '  done',
    '  break',
    'done',
    'if [ -n "$used$loaded" ]; then',
    `  echo ${quote(`The certificate ${name} is still used, so it was kept:`)} >&2`,
    '  echo "$used $loaded" >&2',
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `certbot delete --non-interactive --cert-name ${quote(name)}`,
    ''
  ].join('\n')
}
