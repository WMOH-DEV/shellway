import type { ProbeDefinition, ServerFacts } from '../../../types/server/core'
import type { DeploySiteRef, SitesInventory, SiteVhost } from './types'

export const INVENTORY_PROBE = 'sites.inventory'

const MAX_VHOST_BYTES = 262144

const VHOST_GLOBS = ['/etc/nginx/sites-enabled/*', '/etc/nginx/conf.d/*.conf', '/etc/apache2/sites-enabled/*', '/etc/httpd/conf.d/*.conf']

const SCRIPT = `printf '@@user %s\\n' "$(id -un)"
for d in /etc/php/*/fpm; do
  [ -d "$d" ] || continue
  v="\${d#/etc/php/}"
  printf '@@fpm %s\\n' "\${v%/fpm}"
done
for conf in "$HOME"/.shellway-deploy/sites/*/site.conf; do
  [ -f "$conf" ] || continue
  name="$(basename "$(dirname "$conf")")"
  path="$(sed -n "s/^SITE_PATH='\\(.*\\)'\$/\\1/p" "$conf" | head -n 1)"
  owner="$(stat -L -c %U "$path" 2>/dev/null || true)"
  printf '@@site %s\\t%s\\t%s\\n' "$name" "$owner" "$path"
done
for f in ${VHOST_GLOBS.join(' ')}; do
  [ -f "$f" ] || continue
  real="$(readlink -f "$f")"
  [ -r "$real" ] || continue
  [ "$(wc -c < "$real")" -le ${MAX_VHOST_BYTES} ] || continue
  printf '@@vhost %s\\t%s\\t%s\\n' "$(sha256sum "$real" | cut -d' ' -f1)" "$f" "$real"
  base64 < "$real" | tr -d '\\n'
  printf '\\n'
done
`

const SHA256 = /^[0-9a-f]{64}$/

function decodeBase64(text: string): string {
  const binary = atob(text)
  return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)))
}

function parseSite(rest: string): DeploySiteRef | null {
  const [name, owner, path] = rest.split('\t')
  return name && path ? { name, owner: owner ?? '', path } : null
}

function parseVhostHeader(rest: string): Omit<SiteVhost, 'content'> | null {
  const [sha256, path, realPath] = rest.split('\t')
  return SHA256.test(sha256 ?? '') && path?.startsWith('/') && realPath?.startsWith('/') ? { sha256, path, realPath } : null
}

export function parseInventory(stdout: string): SitesInventory {
  const inventory: SitesInventory = { user: '', fpmVersions: [], sites: [], vhosts: [] }
  const lines = stdout.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const [marker, ...restParts] = lines[i].split(' ')
    const rest = restParts.join(' ')
    if (marker === '@@user') inventory.user = rest.trim()
    else if (marker === '@@fpm' && /^\d+\.\d+$/.test(rest)) inventory.fpmVersions.push(rest)
    else if (marker === '@@site') {
      const site = parseSite(rest)
      if (site) inventory.sites.push(site)
    } else if (marker === '@@vhost') {
      const header = parseVhostHeader(rest)
      const body = lines[i + 1] ?? ''
      i++
      if (header && !inventory.vhosts.some((v) => v.path === header.path)) inventory.vhosts.push({ ...header, content: decodeBase64(body) })
    }
  }
  return inventory
}

export const inventoryProbe: ProbeDefinition<SitesInventory> = {
  id: INVENTORY_PROBE,
  area: 'sites',
  root: false,
  timeoutSeconds: 20,
  script: SCRIPT,
  parse: parseInventory
}

export function inventoryFrom(facts: ServerFacts): SitesInventory | null {
  const result = facts[INVENTORY_PROBE]
  return result?.status === 'ok' ? (result.data as SitesInventory) : null
}

export const vhostFor = (inventory: SitesInventory | null, path: string): SiteVhost | undefined =>
  inventory?.vhosts.find((v) => v.path === path || v.realPath === path)
