import type { ExecResult } from '../../utils/sshExec'
import { shellEscape } from '../../utils/shellEscape'
import type { RemoteExec } from '../deploy/DeployService'
import type { ActionResult, CertbotAction, CertbotLineage, OriginCert, ServerBlock, ServerFacts, ServerScan } from '../../../src/types/ssl'
import { certbotCommand } from '../../../src/utils/ssl/commands'
import { parseCertbotCertificates, parseFacts, parseProbes, SECTION_MARK } from './parse'
import { apacheSites } from '../webServer/apacheSites'
import { nginxSites } from '../webServer/nginxSites'
import { siteServer } from '../../../src/utils/webServer/siteServer'
import type { SiteRead } from '../webServer/siteReader'
import type { ParsedFacts, ProbeTarget } from './parse'
import { isPattern } from './report'

export type OutputSink = (chunk: string) => void

const FACTS_TIMEOUT_MS = 30_000
const CERTBOT_LIST_TIMEOUT_MS = 60_000
const PROBE_BASE_TIMEOUT_MS = 20_000
const PROBE_PER_NAME_TIMEOUT_MS = 12_000
const PROBE_MAX_TIMEOUT_MS = 180_000
const CERTBOT_ACTION_TIMEOUT_MS = 10 * 60_000
const PROBE_SECONDS = 10

const FACTS_SCRIPT = `PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin:/snap/bin"; export PATH
section() { printf '${SECTION_MARK} %s\\n' "$1"; }
can() { if [ -n "$1" ] && sudo -n -l "$1" >/dev/null 2>&1 </dev/null; then echo 1; else echo 0; fi; }
certbot_path=$(command -v certbot)
nginx_path=$(command -v nginx)
apache_path=$(command -v apache2ctl || command -v apachectl)
section USER; id -un </dev/null
section ADDRESSES; hostname -I 2>/dev/null </dev/null
section SSH; echo "server=$(set -- $SSH_CONNECTION; echo "$3")"
section NGINX_V; nginx -v 2>&1 </dev/null
section OPENSSL_V; openssl version 2>&1 </dev/null
section CERTBOT_V; certbot --version 2>&1 </dev/null
section PATHS; echo "certbot=$certbot_path"; echo "nginx=$nginx_path"; echo "apache=$apache_path"
section SUDO
echo "certbot=$(can "$certbot_path")"
echo "nginx=$(can "$nginx_path")"
echo "apache=$(can "$apache_path")"
if sudo -n true >/dev/null 2>&1 </dev/null; then echo full=1; else echo full=0; fi
section ACTIVE
for unit in nginx apache2 httpd caddy; do echo "$unit=$(systemctl is-active $unit 2>/dev/null </dev/null)"; done
section APACHE_V; if [ -n "$apache_path" ]; then "$apache_path" -v 2>&1 </dev/null; fi
section APACHE_LAYOUT; if [ -f /etc/apache2/apache2.conf ]; then echo debian; elif [ -f /etc/httpd/conf/httpd.conf ]; then echo rhel; fi
section LISTEN; { sudo -n ss -ltnp 2>/dev/null || ss -ltnp 2>/dev/null; } </dev/null
section RENEWAL
timer=""
timers=$(systemctl list-timers --all --no-pager 2>/dev/null </dev/null)
case "$timers" in
  *snap.certbot.renew.timer*) timer=snap.certbot.renew.timer;;
  *certbot.timer*) timer=certbot.timer;;
esac
echo "timer=$timer"
if [ -n "$timer" ]; then
  service="\${timer%.timer}.service"
  show=$(systemctl show "$service" -p Result -p ExecMainExitTimestamp 2>/dev/null </dev/null)
  echo "$show"
  stamp=$(echo "$show" | sed -n 's/^ExecMainExitTimestamp=//p')
  if [ -n "$stamp" ]; then echo "ExitEpoch=$(date -d "$stamp" +%s 2>/dev/null)"; fi
elif [ -f /etc/cron.d/certbot ]; then
  echo cron=1
fi
section JOURNAL
if [ -n "$timer" ]; then journalctl -u "$service" -n 40 --no-pager 2>/dev/null </dev/null; fi
`

function probeScript(targets: ProbeTarget[]): string {
  const calls = targets.map((t, i) => `probe ${i} ${shellEscape(t.address)} ${shellEscape(t.name)}`)
  return `limit=""
if command -v timeout >/dev/null 2>&1; then limit="timeout ${PROBE_SECONDS}"; fi
probe() {
  out=$($limit openssl s_client -connect "$2" -servername "$3" </dev/null 2>/dev/null)
  status=$?
  case "$out" in
    *"BEGIN CERTIFICATE"*) printf '${SECTION_MARK} PROBE %s ok\\n' "$1"; readCertificate;;
    *) if [ "$status" = 124 ]; then state=timeout; else state=nocert; fi; printf '${SECTION_MARK} PROBE %s %s\\n' "$1" "$state";;
  esac
}
readCertificate() {
  printf '%s\\n' "$out" | openssl x509 -noout -subject -issuer -startdate -enddate -ext subjectAltName 2>/dev/null ||
    printf '%s\\n' "$out" | openssl x509 -noout -subject -issuer -startdate -enddate -text 2>/dev/null
}
${calls.join('\n')}
`
}

function probeTargets(blocks: ServerBlock[]): ProbeTarget[] {
  const byName = new Map<string, ProbeTarget>()
  for (const block of blocks.filter((b) => b.tls)) {
    for (const name of block.names) {
      if (name === '_' || isPattern(name) || byName.has(name)) continue
      byName.set(name, { name, address: block.probeAddress })
    }
  }
  return [...byName.values()]
}

function probeTimeout(count: number): number {
  return Math.min(PROBE_MAX_TIMEOUT_MS, PROBE_BASE_TIMEOUT_MS + count * PROBE_PER_NAME_TIMEOUT_MS)
}

export interface ServerConfig {
  facts: ServerFacts
  blocks: ServerBlock[]
}

const DEFAULT_PROBE_ADDRESS = '127.0.0.1:443'

export class SslService {
  constructor(private readonly exec: RemoteExec) {}

  async scan(): Promise<ServerScan> {
    const facts = await this.readFacts()
    const [sites, lineages] = await Promise.all([this.readSites(facts), this.readLineages(facts)])
    const origins = await this.probeOrigins(sites.blocks, facts)
    return { facts: { ...facts, nginxParse: sites.parse }, blocks: sites.blocks, lineages, origins }
  }

  async readFacts(): Promise<ParsedFacts> {
    const result = await this.runScript(FACTS_SCRIPT, FACTS_TIMEOUT_MS)
    return parseFacts(result.stdout)
  }

  async readConfig(): Promise<ServerConfig> {
    const facts = await this.readFacts()
    const sites = await this.readSites(facts)
    return { facts: { ...facts, nginxParse: sites.parse }, blocks: sites.blocks }
  }

  async probeNames(names: string[], config: ServerConfig): Promise<Record<string, OriginCert>> {
    if (names.length === 0 || config.facts.openssl === null) return {}
    const targets = names.map((name) => ({ name, address: this.probeAddressOf(name, config.blocks) }))
    const result = await this.runScript(probeScript(targets), probeTimeout(targets.length))
    return parseProbes(result.stdout, targets)
  }

  async runCertbot(lineage: string, action: CertbotAction, onOutput: OutputSink): Promise<ActionResult> {
    const chunks: string[] = []
    const result = await this.exec(certbotCommand(lineage, action), {
      timeoutMs: CERTBOT_ACTION_TIMEOUT_MS,
      onOutput: (chunk) => {
        chunks.push(chunk)
        onOutput(chunk)
      }
    })
    return { code: result.code, output: chunks.join('') }
  }

  private runScript(script: string, timeoutMs: number): Promise<ExecResult> {
    return this.exec('sh -s', { stdin: script, timeoutMs })
  }

  private probeAddressOf(name: string, blocks: ServerBlock[]): string {
    const wanted = name.toLowerCase()
    const block = blocks.find((b) => b.names.some((n) => n.toLowerCase() === wanted))
    return block?.probeAddress ?? DEFAULT_PROBE_ADDRESS
  }

  private readSites(facts: ParsedFacts): Promise<SiteRead> {
    const reader = siteServer(facts) === 'apache' ? apacheSites : nginxSites
    return reader.read(this.exec, facts)
  }

  private async readLineages(facts: ParsedFacts): Promise<CertbotLineage[]> {
    const path = facts.paths.certbot
    if (!path || !(facts.sudo.certbot || facts.sudo.full)) return []
    const result = await this.exec(`sudo -n ${shellEscape(path)} certificates`, { timeoutMs: CERTBOT_LIST_TIMEOUT_MS })
    return result.code === 0 ? parseCertbotCertificates(result.stdout) : []
  }

  private async probeOrigins(blocks: ServerBlock[], facts: ParsedFacts): Promise<Record<string, OriginCert>> {
    const targets = probeTargets(blocks)
    if (targets.length === 0 || facts.openssl === null) return {}
    const result = await this.runScript(probeScript(targets), probeTimeout(targets.length))
    return parseProbes(result.stdout, targets)
  }
}
