import type { ProbeDefinition } from '@/types/server/core'
import { decodeServerText } from '../serverText'
import { SITES_PROBE } from './facts'
import { hasSection, splitSections, type OutputSection } from './sections'
import type { SiteEnv, SiteEnvFacts } from './types'

const MAX_ENV_BYTES = 65536
const ENCODED = 'b64:'

const SCRIPT = `R="$HOME/.shellway-deploy"
B="$R/bin/shellway-deploy"
[ -x "$B" ] || { echo @@nodeploy; exit 0; }
for c in "$R"/sites/*/site.conf; do
  [ -f "$c" ] || continue
  n=$(basename "$(dirname "$c")")
  p=$("$B" env-path "$n" 2>/dev/null) || continue
  echo "@@site $n"
  printf '%s\\n' "$p"
  if [ -f "$p" ] && [ -r "$p" ] && [ "$(wc -c < "$p")" -le ${MAX_ENV_BYTES} ] && b=$(base64 -w0 "$p"); then
    stat -c '%U:%G %a' "$p"
    printf '%s' "$b" | base64 -d | sha256sum | cut -d' ' -f1
    printf 'b64:%s\\n' "$b"
  fi
done
`

function unquote(value: string): string {
  const trimmed = value.trim()
  const quoted = /^(["'])(.*)\1$/.exec(trimmed)
  return quoted ? quoted[2] : trimmed.replace(/\s+#.*$/, '')
}

export function envValue(content: string, key: string): string {
  const line = content.split('\n').find((candidate) => candidate.startsWith(`${key}=`))
  return line ? unquote(line.slice(key.length + 1)) : ''
}

function parseSite(section: OutputSection): SiteEnv {
  const [path = '', stat = '', sha256 = '', encoded] = section.lines
  const [owner = '', mode = ''] = stat.split(' ')
  const encodedContent = encoded?.startsWith(ENCODED) ? encoded.slice(ENCODED.length) : null
  const content = encodedContent === null ? '' : decodeServerText(encodedContent)
  return {
    site: section.arg,
    path,
    readable: encodedContent !== null,
    owner,
    mode,
    sha256,
    content,
    db: { connection: envValue(content, 'DB_CONNECTION'), database: envValue(content, 'DB_DATABASE'), username: envValue(content, 'DB_USERNAME') }
  }
}

export function parseSiteEnvs(stdout: string): SiteEnvFacts {
  const sections = splitSections(stdout)
  if (hasSection(sections, 'nodeploy')) return { deployInstalled: false, sites: [] }
  return { deployInstalled: true, sites: sections.filter((section) => section.name === 'site').map(parseSite) }
}

export const siteEnvProbe: ProbeDefinition<SiteEnvFacts> = {
  id: SITES_PROBE,
  area: 'databases',
  root: false,
  timeoutSeconds: 20,
  script: SCRIPT,
  parse: parseSiteEnvs
}
