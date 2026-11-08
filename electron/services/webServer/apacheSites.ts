import { parseApacheSites } from '../../../src/utils/webServer/apache/sites'
import { parseVhostDump } from '../../../src/utils/webServer/apache/vhosts'
import { splitConfigFiles } from '../../../src/utils/webServer/configDump'
import { shellEscape } from '../../utils/shellEscape'
import type { RemoteExec } from '../deploy/DeployService'
import type { ParsedFacts } from '../ssl/parse'
import type { SiteRead, SiteReader } from './siteReader'

const APACHE_TIMEOUT_MS = 30_000
const UNREADABLE_MARK = '@@SW@@ UNREADABLE'

const ENABLED_FILES_SCRIPT = `for file in /etc/apache2/sites-enabled/*.conf /etc/httpd/conf.d/*.conf; do
  if [ -f "$file" ] && [ -r "$file" ]; then
    printf '\\n# configuration file %s:\\n' "$file"
    cat "$file" </dev/null
  fi
done
`

const UNAVAILABLE: SiteRead = { blocks: [], parse: 'unavailable' }

function catFilesScript(files: string[]): string {
  return files.map((file) => {
    const path = shellEscape(file)
    return `if [ -f ${path} ] && [ -r ${path} ]; then printf '\\n# configuration file %s:\\n' ${path}; cat ${path} </dev/null; else printf '${UNREADABLE_MARK} %s\\n' ${path} >&2; fi`
  }).join('\n') + '\n'
}

const canSudo = (facts: ParsedFacts): boolean => facts.sudo.apache || facts.sudo.full

async function listVhostFiles(exec: RemoteExec, path: string, facts: ParsedFacts): Promise<string[] | null> {
  const command = `${canSudo(facts) ? 'sudo -n ' : ''}${shellEscape(path)} -S`
  const result = await exec(command, { timeoutMs: APACHE_TIMEOUT_MS })
  if (result.code !== 0) return null
  const { files } = parseVhostDump(`${result.stdout}\n${result.stderr}`)
  return files.length > 0 ? files : null
}

async function readListedFiles(exec: RemoteExec, files: string[], facts: ParsedFacts): Promise<SiteRead> {
  const command = facts.sudo.full ? 'sudo -n sh -s' : 'sh -s'
  const result = await exec(command, { stdin: catFilesScript(files), timeoutMs: APACHE_TIMEOUT_MS })
  const read = splitConfigFiles(result.stdout).length
  if (read === 0) return UNAVAILABLE
  const complete = read === files.length && !result.stderr.includes(UNREADABLE_MARK)
  return { blocks: parseApacheSites(result.stdout), parse: complete ? 'full' : 'partial' }
}

async function readEnabledFiles(exec: RemoteExec): Promise<SiteRead> {
  const result = await exec('sh -s', { stdin: ENABLED_FILES_SCRIPT, timeoutMs: APACHE_TIMEOUT_MS })
  return splitConfigFiles(result.stdout).length > 0 ? { blocks: parseApacheSites(result.stdout), parse: 'partial' } : UNAVAILABLE
}

export const apacheSites: SiteReader = {
  async read(exec: RemoteExec, facts: ParsedFacts): Promise<SiteRead> {
    const path = facts.paths.apache
    if (!path) return UNAVAILABLE
    const files = await listVhostFiles(exec, path, facts)
    return files ? readListedFiles(exec, files, facts) : readEnabledFiles(exec)
  }
}
