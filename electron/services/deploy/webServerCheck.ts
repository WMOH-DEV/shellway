import type { ServerBlock, ServerFacts } from '../../../src/types/ssl'
import { isInside, type WebServerCheck, type WebServerSite } from '../../../src/utils/webServer/siteFolder'
import { vhostDetail } from '../../../src/utils/webServer/apache/sites'
import { parseModules } from '../../../src/utils/webServer/apache/vhosts'
import { siteServer } from '../../../src/utils/webServer/siteServer'
import { shellEscape } from '../../utils/shellEscape'
import { SslService } from '../ssl/SslService'
import type { RemoteExec } from './DeployService'

const READ_TIMEOUT_MS = 30_000

const sudoPrefix = (allowed: boolean): string => (allowed ? 'sudo -n ' : '')

async function readSite(exec: RemoteExec, block: ServerBlock, facts: ServerFacts): Promise<WebServerSite | null> {
  const read = await exec(`${sudoPrefix(facts.sudo.full)}cat -- ${shellEscape(block.file)}`, { timeoutMs: READ_TIMEOUT_MS })
  if (read.code !== 0) return null
  try {
    return { file: block.file, names: block.names, detail: vhostDetail(read.stdout, block.line) }
  } catch {
    return null
  }
}

async function rewriteLoaded(exec: RemoteExec, facts: ServerFacts): Promise<boolean | null> {
  const path = facts.paths.apache
  if (!path) return null
  const listed = await exec(`${sudoPrefix(facts.sudo.apache || facts.sudo.full)}${shellEscape(path)} -M`, { timeoutMs: READ_TIMEOUT_MS })
  if (listed.code !== 0) return null
  return parseModules(`${listed.stdout}\n${listed.stderr}`).includes('rewrite')
}

const servesFolder = (sitePath: string) => (block: ServerBlock): boolean => block.root !== null && isInside(block.root, sitePath)

export async function readWebServerCheck(exec: RemoteExec, sitePath: string): Promise<WebServerCheck> {
  const { facts, blocks } = await new SslService(exec).readConfig()
  const server = siteServer(facts)
  const check: WebServerCheck = { server, layout: facts.apache?.layout ?? null, read: facts.nginxParse, sites: [], rewriteModule: null }
  if (server !== 'apache') return check
  const serving = blocks.filter(servesFolder(sitePath)).sort((a, b) => Number(b.tls) - Number(a.tls))
  const [sites, rewriteModule] = await Promise.all([Promise.all(serving.map((block) => readSite(exec, block, facts))), rewriteLoaded(exec, facts)])
  return { ...check, sites: sites.filter((site): site is WebServerSite => site !== null), rewriteModule }
}
