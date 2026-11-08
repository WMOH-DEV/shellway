import type { CertbotInstallMethod, OsFamily, PackageManager, PrepFacts, WebServerKind } from '../../../../src/types/ssl'
import type { RemoteExec } from '../../deploy/DeployService'
import { parseKeyValues } from '../../deploy/parse'
import { SECTION_MARK, splitSections } from '../parse'

const PREP_TIMEOUT_MS = 90_000

export const PATH_LINE = 'PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin:/snap/bin"; export PATH'

export const PREP_SCRIPT = `${PATH_LINE}
section() { printf '${SECTION_MARK} %s\\n' "$1"; }
limit=""
if command -v timeout >/dev/null 2>&1; then limit="timeout 30"; fi
certbot_path=$(command -v certbot)
section SUDO
if sudo -n true >/dev/null 2>&1 </dev/null; then echo full=1; else echo full=0; fi
section OS; cat /etc/os-release 2>/dev/null </dev/null
section ARCH; uname -m </dev/null
section WEB
echo "nginx=$(command -v nginx)"
echo "apache=$(command -v apache2 || command -v httpd || command -v apachectl)"
echo "caddy=$(command -v caddy)"
section CERTBOT
echo "path=$certbot_path"
if [ -n "$certbot_path" ]; then $limit "$certbot_path" --version 2>&1 </dev/null; fi
section METHOD
if command -v snap >/dev/null 2>&1 && snap list certbot >/dev/null 2>&1 </dev/null; then echo snap=1; fi
echo "dpkg=$(dpkg-query -W -f='\${Status}' certbot 2>/dev/null </dev/null)"
if rpm -q certbot >/dev/null 2>&1 </dev/null; then echo rpm=1; fi
if [ -x /opt/certbot/bin/certbot ]; then echo pip=1; fi
section PLUGINS
if [ -n "$certbot_path" ]; then
  if sudo -n -l "$certbot_path" >/dev/null 2>&1 </dev/null; then $limit sudo -n "$certbot_path" plugins --text 2>&1 </dev/null
  else $limit "$certbot_path" plugins --text 2>&1 </dev/null; fi
fi
section SNAPD
if command -v snap >/dev/null 2>&1; then $limit snap version 2>/dev/null </dev/null; fi
section PM
echo "apt=$(command -v apt-get)"
echo "dnf=$(command -v dnf)"
echo "yum=$(command -v yum)"
section TIMER
for unit in snap.certbot.renew.timer certbot.timer certbot-renew.timer; do
  if [ "$(systemctl is-active $unit 2>/dev/null </dev/null)" = active ]; then echo "timer=$unit"; break; fi
done
`

const DEBIAN_IDS = new Set(['debian', 'ubuntu'])
const RHEL_IDS = new Set(['rhel', 'fedora', 'centos'])

function unquote(value: string): string {
  return value.replace(/^(["'])(.*)\1$/, '$2')
}

function osRelease(body: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(parseKeyValues(body))) values[key] = unquote(value.trim())
  return values
}

function osFamily(id: string, idLike: string): OsFamily {
  const tokens = `${id} ${idLike}`.toLowerCase().split(/\s+/)
  if (tokens.some((token) => DEBIAN_IDS.has(token))) return 'debian'
  return tokens.some((token) => RHEL_IDS.has(token)) ? 'rhel' : 'other'
}

function webServer(web: Record<string, string>): WebServerKind | null {
  if (web.nginx) return 'nginx'
  if (web.apache) return 'apache'
  return web.caddy ? 'caddy' : null
}

function packageManager(pm: Record<string, string>): PackageManager | null {
  if (pm.apt) return 'apt'
  if (pm.dnf) return 'dnf'
  return pm.yum ? 'yum' : null
}

function installMethod(method: Record<string, string>, manager: PackageManager | null): CertbotInstallMethod {
  if (method.snap === '1') return 'snap'
  if (method.dpkg === 'install ok installed') return 'apt'
  if (method.rpm === '1') return manager === 'dnf' || manager === 'yum' ? manager : 'unknown'
  return method.pip === '1' ? 'pip' : 'unknown'
}

function pluginNames(output: string): string[] {
  return [...output.matchAll(/^\* (\S+)\s*$/gm)].map((match) => match[1])
}

function snapdVersion(output: string): string | null {
  const version = /^snapd\s+(\S+)/m.exec(output)?.[1]
  return version && /^\d/.test(version) ? version : null
}

export function parsePrepFacts(output: string): PrepFacts {
  const sections = Object.fromEntries(splitSections(output).map((s) => [s.name, s.body]))
  const os = osRelease(sections.OS ?? '')
  const certbot = parseKeyValues(sections.CERTBOT ?? '')
  const manager = packageManager(parseKeyValues(sections.PM ?? ''))
  return {
    os: {
      id: (os.ID ?? '').toLowerCase(),
      versionId: os.VERSION_ID ?? '',
      family: osFamily(os.ID ?? '', os.ID_LIKE ?? ''),
      pretty: os.PRETTY_NAME ?? ''
    },
    arch: (sections.ARCH ?? '').trim(),
    webServer: webServer(parseKeyValues(sections.WEB ?? '')),
    certbot: certbot.path
      ? { path: certbot.path, version: /certbot\s+([\d.]+)/.exec(sections.CERTBOT ?? '')?.[1] ?? '', method: installMethod(parseKeyValues(sections.METHOD ?? ''), manager) }
      : null,
    plugins: pluginNames(sections.PLUGINS ?? ''),
    snapd: snapdVersion(sections.SNAPD ?? ''),
    packageManager: manager,
    renewalTimer: parseKeyValues(sections.TIMER ?? '').timer || null,
    fullSudo: parseKeyValues(sections.SUDO ?? '').full === '1'
  }
}

export async function detectPrep(exec: RemoteExec): Promise<PrepFacts> {
  const result = await exec('sh -s', { stdin: PREP_SCRIPT, timeoutMs: PREP_TIMEOUT_MS })
  return parsePrepFacts(result.stdout)
}
