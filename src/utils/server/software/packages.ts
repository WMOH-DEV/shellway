import { catalogGlobs, catalogPackageNames, catalogServices } from './catalog'
import { hasSection, keyValues, sectionLines, splitSections } from './sections'
import type { InstalledPackage, NodeFacts, PackagesFacts, ServiceState } from './types'

export const PACKAGES_SCRIPT = `if ! command -v dpkg-query >/dev/null 2>&1; then echo '@@unsupported'; exit 0; fi
list=$(dpkg-query -W -f='\${Package}\\t\${Status}\\t\${Version}\\n' ${catalogPackageNames().join(' ')} ${catalogGlobs().map((glob) => `'${glob}'`).join(' ')} 2>/dev/null)
echo '@@dpkg'
printf '%s\\n' "$list"
installed=$(printf '%s\\n' "$list" | awk -F'\\t' '$2=="install ok installed"{print $1}')
echo '@@policy'
[ -n "$installed" ] && LC_ALL=C apt-cache policy $installed 2>/dev/null | grep -E '^[^ ].*:$|^  (Installed|Candidate):'
echo '@@services'
for u in ${catalogServices().join(' ')}; do echo "$u=$(systemctl is-active "$u" 2>/dev/null)"; done
echo '@@tools'
echo "composer=$(COMPOSER_NO_INTERACTION=1 composer --version 2>/dev/null | sed -n 's/^Composer version \\([^ ]*\\).*/\\1/p' | head -n 1)"
echo "certbot_snap=$(snap list certbot 2>/dev/null | awk 'NR==2{print $2}')"
echo "node=$(node --version 2>/dev/null)"
echo "node_path=$(command -v node 2>/dev/null)"
echo "nodesource=$(ls /etc/apt/sources.list.d 2>/dev/null | grep -ci nodesource)"
echo "nvm=$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tr '\\n' ' ')"
pm2=$(command -v pm2 2>/dev/null)
if [ -n "$pm2" ]; then
  pkg="$(dirname "$(dirname "$(readlink -f "$pm2")")")/package.json"
  echo "pm2=$(sed -n 's/^ *"version": *"\\([^"]*\\)".*/\\1/p' "$pkg" 2>/dev/null | head -n 1)"
fi
echo '@@nginx-sites'
ls /etc/nginx/sites-enabled 2>/dev/null
echo '@@apache-sites'
ls /etc/apache2/sites-enabled 2>/dev/null
echo '@@listen'
ss -ltnH 2>/dev/null | awk '{print $4}'
exit 0
`

const DEFAULT_SITES = new Set(['default', '000-default.conf', 'default-ssl.conf'])

function parseDpkg(lines: string[]): Map<string, string> {
  const installed = new Map<string, string>()
  for (const line of lines) {
    const [name, status, version] = line.split('\t')
    if (status === 'install ok installed' && name && version) installed.set(name, version)
  }
  return installed
}

function parsePolicy(lines: string[]): Map<string, string> {
  const candidates = new Map<string, string>()
  let current = ''
  for (const line of lines) {
    const header = /^(\S+):$/.exec(line)
    if (header) current = header[1]
    const candidate = /^\s+Candidate:\s*(\S+)/.exec(line)
    if (candidate && current && candidate[1] !== '(none)') candidates.set(current, candidate[1])
  }
  return candidates
}

function toInstalled(versions: Map<string, string>, candidates: Map<string, string>): InstalledPackage[] {
  return [...versions].map(([name, version]) => {
    const candidate = candidates.get(name) ?? null
    return { name, version, candidate: candidate && candidate !== version ? candidate : null }
  })
}

const SERVICE_STATES: ServiceState[] = ['active', 'inactive', 'failed', 'activating']

function parseServices(lines: string[]): Record<string, ServiceState> {
  return Object.fromEntries(Object.entries(keyValues(lines)).map(([unit, state]) => [unit, SERVICE_STATES.includes(state as ServiceState) ? (state as ServiceState) : 'unknown']))
}

const nonEmpty = (value: string | undefined): string | null => (value ? value : null)

function parseNode(tools: Record<string, string>, versions: Map<string, string>): NodeFacts {
  const nvmVersions = (tools.nvm ?? '').split(/\s+/).filter(Boolean)
  const version = nonEmpty(tools.node?.replace(/^v/, ''))
  return { version, source: nodeSource(tools, versions, nvmVersions), nvmVersions, pm2Version: nonEmpty(tools.pm2) }
}

function nodeSource(tools: Record<string, string>, versions: Map<string, string>, nvmVersions: string[]): NodeFacts['source'] {
  if (versions.has('nodejs')) return Number(tools.nodesource) > 0 || versions.get('nodejs')?.includes('nodesource') ? 'nodesource' : 'distro'
  if (nvmVersions.length > 0 || (tools.node_path ?? '').includes('/.nvm/')) return 'nvm'
  return tools.node ? 'other' : null
}

const countSites = (lines: string[]): number => lines.map((line) => line.trim()).filter((name) => name && !DEFAULT_SITES.has(name)).length

export function parsePackages(stdout: string): PackagesFacts {
  const sections = splitSections(stdout)
  const versions = parseDpkg(sectionLines(sections, 'dpkg'))
  const tools = keyValues(sectionLines(sections, 'tools'))
  return {
    supported: !hasSection(sections, 'unsupported') && hasSection(sections, 'dpkg'),
    installed: toInstalled(versions, parsePolicy(sectionLines(sections, 'policy'))),
    services: parseServices(sectionLines(sections, 'services')),
    composerVersion: nonEmpty(tools.composer),
    certbotSnapVersion: nonEmpty(tools.certbot_snap),
    node: parseNode(tools, versions),
    siteCounts: { nginx: countSites(sectionLines(sections, 'nginx-sites')), apache: countSites(sectionLines(sections, 'apache-sites')) },
    listening: [...new Set(sectionLines(sections, 'listen').map((line) => line.trim()))]
  }
}

export const installedPackage = (facts: PackagesFacts, name: string): InstalledPackage | undefined => facts.installed.find((item) => item.name === name)

export const bindingsFor = (facts: PackagesFacts, port: number): string[] => facts.listening.filter((address) => address.endsWith(`:${port}`))

export const isPublicBinding = (address: string): boolean => /^(0\.0\.0\.0|\*|\[::\]|::):\d+$/.test(address)
