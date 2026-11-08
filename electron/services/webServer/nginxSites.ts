import { shellEscape } from '../../utils/shellEscape'
import type { RemoteExec } from '../deploy/DeployService'
import { hasConfigFiles, parseServerBlocks } from '../ssl/parse'
import type { ParsedFacts } from '../ssl/parse'
import type { SiteRead, SiteReader } from './siteReader'

const NGINX_TIMEOUT_MS = 30_000

const READ_NGINX_FILES_SCRIPT = `for file in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
  if [ -f "$file" ] && [ -r "$file" ]; then
    printf '\\n# configuration file %s:\\n' "$file"
    cat "$file" </dev/null
  fi
done
`

const UNAVAILABLE: SiteRead = { blocks: [], parse: 'unavailable' }

const parsed = (dump: string, parse: SiteRead['parse']): SiteRead => ({ blocks: parseServerBlocks(dump), parse })

async function readFullDump(exec: RemoteExec, path: string): Promise<string | null> {
  const full = await exec(`sudo -n ${shellEscape(path)} -T`, { timeoutMs: NGINX_TIMEOUT_MS })
  return full.code === 0 && hasConfigFiles(full.stdout) ? full.stdout : null
}

export const nginxSites: SiteReader = {
  async read(exec: RemoteExec, facts: ParsedFacts): Promise<SiteRead> {
    const path = facts.paths.nginx
    if (!path) return UNAVAILABLE
    if (facts.sudo.nginx || facts.sudo.full) {
      const dump = await readFullDump(exec, path)
      if (dump !== null) return parsed(dump, 'full')
    }
    const files = await exec('sh -s', { stdin: READ_NGINX_FILES_SCRIPT, timeoutMs: NGINX_TIMEOUT_MS })
    return hasConfigFiles(files.stdout) ? parsed(files.stdout, 'partial') : UNAVAILABLE
  }
}
