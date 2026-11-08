import type { CreateSiteInput, SiteServer } from '@/types/createSite'
import { EXIT_NGINX_TEST, EXIT_REFUSED, EXIT_RELOAD } from '../ssl/originCa/exitCodes'
import { heredoc } from '../ssl/originCa/heredoc'
import { assertOwner, assertPhpVersion, assertSha256, assertSiteName } from './validate'
import { changedByHand } from './refusal'

type PoolFacts = Pick<CreateSiteInput, 'server' | 'phpVersion' | 'siteName'>

export interface PoolLayout {
  file: string
  socket: string
  test: string
  pidFile: string
  service: string
  webUser: string
}

const SOCKET_WAIT_SECONDS = 10

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

const isRhel = (server: SiteServer): boolean => server.kind === 'apache' && server.layout === 'rhel'

export function poolLayout({ server, phpVersion, siteName }: PoolFacts): PoolLayout {
  const site = assertSiteName(siteName)
  if (isRhel(server)) {
    return { file: `/etc/php-fpm.d/${site}.conf`, socket: `/run/php-fpm/${site}.sock`, test: 'php-fpm -t', pidFile: '/run/php-fpm/php-fpm.pid', service: 'php-fpm', webUser: 'apache' }
  }
  const version = assertPhpVersion(phpVersion)
  return {
    file: `/etc/php/${version}/fpm/pool.d/${site}.conf`,
    socket: `/run/php/php${version}-fpm-${site}.sock`,
    test: `php-fpm${version} -t`,
    pidFile: `/run/php/php${version}-fpm.pid`,
    service: `php${version}-fpm`,
    webUser: 'www-data'
  }
}

export function assertPoolOwner(owner: string): string {
  if (assertOwner(owner) === 'root') throw new Error('PHP-FPM will not run a site as root. Log in as a regular user, then open Create site again.')
  return owner
}

export function poolText(facts: PoolFacts & Pick<CreateSiteInput, 'owner'>): string {
  const { socket, webUser } = poolLayout(facts)
  return [
    `[${assertSiteName(facts.siteName)}]`,
    `user = ${assertPoolOwner(facts.owner)}`,
    `listen = ${socket}`,
    `listen.owner = ${webUser}`,
    `listen.group = ${webUser}`,
    'listen.mode = 0660',
    'pm = ondemand',
    'pm.max_children = 10',
    'pm.process_idle_timeout = 10s',
    'pm.max_requests = 500',
    ...(facts.server.kind === 'apache' ? ['php_admin_value[realpath_cache_ttl] = 2'] : []),
    ''
  ].join('\n')
}

const reloadLine = ({ pidFile, service }: PoolLayout): string =>
  `{ if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet ${quote(service)}; then systemctl reload ${quote(service)}; else [ -f ${quote(pidFile)} ] && kill -USR2 "$(cat ${quote(pidFile)})"; fi; }`

export function createPoolScript(facts: PoolFacts & Pick<CreateSiteInput, 'owner'>): string {
  const layout = poolLayout(facts)
  const file = quote(layout.file)
  const reload = reloadLine(layout)
  return [
    'set -e',
    `if [ -e ${file} ] || [ -L ${file} ]; then`,
    `  echo ${quote(`${layout.file} already exists. Nothing was changed.`)} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `cat > ${file} ${heredoc(poolText(facts)).trimEnd()}`,
    `if ! ${layout.test}; then`,
    `  rm -f ${file}`,
    `  echo ${quote('PHP-FPM rejected the new pool. It was removed.')} >&2`,
    `  exit ${EXIT_NGINX_TEST}`,
    'fi',
    `if ! ${reload}; then`,
    `  rm -f ${file}`,
    `  echo ${quote('PHP-FPM is not running, so the new pool could not start. It was removed.')} >&2`,
    `  exit ${EXIT_RELOAD}`,
    'fi',
    `i=0; while [ ! -S ${quote(layout.socket)} ] && [ $i -lt ${SOCKET_WAIT_SECONDS} ]; do sleep 1; i=$((i + 1)); done`,
    `if [ ! -S ${quote(layout.socket)} ]; then`,
    `  rm -f ${file}`,
    `  ${reload} || true`,
    `  echo ${quote(`PHP-FPM did not open ${layout.socket}. The new pool was removed.`)} >&2`,
    `  exit ${EXIT_RELOAD}`,
    'fi',
    ''
  ].join('\n')
}

export function removePoolScript(facts: PoolFacts, sha256: string): string {
  const layout = poolLayout(facts)
  const file = quote(layout.file)
  return [
    'set -e',
    `if [ ! -f ${file} ]; then echo ${quote(`${layout.file} is already gone.`)}; exit 0; fi`,
    `if [ "$(sha256sum ${file} | cut -d' ' -f1)" != ${quote(assertSha256(sha256))} ]; then`,
    `  echo ${quote(changedByHand(layout.file))} >&2`,
    `  exit ${EXIT_REFUSED}`,
    'fi',
    `rm -f ${file}`,
    `${reloadLine(layout)} || true`,
    ''
  ].join('\n')
}
