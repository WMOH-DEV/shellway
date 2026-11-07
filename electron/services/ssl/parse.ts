import type { ApacheFacts, CertKind, CertbotLineage, OriginCert, RenewalInfo, RenewalMechanism, ServerBlock, ServerFacts, ServingWebServer } from '../../../src/types/ssl'
import { splitConfigFiles } from '../../../src/utils/webServer/configDump'
import { parseKeyValues } from '../deploy/parse'

export const SECTION_MARK = '@@SW@@'

export interface Section {
  name: string
  arg: string
  body: string
}

export interface ProbeTarget {
  name: string
  address: string
}

export type ParsedFacts = Omit<ServerFacts, 'nginxParse'>

const SECTION_HEADER = new RegExp(`^${SECTION_MARK} (\\S+)(?: (.*))?$`)

export function splitSections(text: string): Section[] {
  const sections: Section[] = []
  for (const line of text.replace(/\n$/, '').split('\n')) {
    const header = SECTION_HEADER.exec(line.replace(/\r$/, ''))
    if (header) sections.push({ name: header[1], arg: (header[2] ?? '').trim(), body: '' })
    else if (sections.length > 0) sections[sections.length - 1].body += `${line}\n`
  }
  return sections
}

function sectionBodies(text: string): Record<string, string> {
  return Object.fromEntries(splitSections(text).map((s) => [s.name, s.body]))
}

type Token = { kind: 'word' | ';' | '{' | '}'; value: string; line: number }

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n'
const isDelimiter = (ch: string) => isSpace(ch) || ch === ';' || ch === '{' || ch === '}'

function readQuoted(text: string, start: number): { value: string; end: number; lines: number } {
  const quote = text[start]
  let value = ''
  let lines = 0
  let i = start + 1
  for (; i < text.length && text[i] !== quote; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      i++
      value += text[i] === quote ? quote : `\\${text[i]}`
    } else value += text[i]
    if (text[i] === '\n') lines++
  }
  return { value, end: i + 1, lines }
}

function readWord(text: string, start: number): { value: string; end: number } {
  let i = start
  while (i < text.length && !isDelimiter(text[i])) i++
  return { value: text.slice(start, i), end: i }
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let line = 1
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') {
      line++
      i++
    } else if (isSpace(ch)) i++
    else if (ch === '#') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (ch === ';' || ch === '{' || ch === '}') {
      tokens.push({ kind: ch, value: ch, line })
      i++
    } else if (ch === '"' || ch === "'") {
      const quoted = readQuoted(text, i)
      tokens.push({ kind: 'word', value: quoted.value, line })
      line += quoted.lines
      i = quoted.end
    } else {
      const word = readWord(text, i)
      tokens.push({ kind: 'word', value: word.value, line })
      i = word.end
    }
  }
  return tokens
}

interface Statement {
  name: string
  args: string[]
  line: number
  body: Statement[] | null
}

function parseStatements(text: string): Statement[] {
  const root: Statement = { name: '', args: [], line: 0, body: [] }
  const stack = [root]
  let words: Token[] = []
  const statement = (body: Statement[] | null): Statement => ({
    name: words[0].value,
    args: words.slice(1).map((w) => w.value),
    line: words[0].line,
    body
  })
  for (const token of tokenize(text)) {
    const parent = stack[stack.length - 1]
    if (token.kind === 'word') words.push(token)
    else if (token.kind === ';') {
      if (words.length > 0) parent.body!.push(statement(null))
      words = []
    } else if (token.kind === '{') {
      if (words.length > 0) {
        const block = statement([])
        parent.body!.push(block)
        stack.push(block)
      }
      words = []
    } else {
      words = []
      if (stack.length > 1) stack.pop()
    }
  }
  return root.body!
}

function findServers(statements: Statement[]): Statement[] {
  return statements.flatMap((s) => {
    if (s.name === 'server' && s.body) return [s]
    return s.body ? findServers(s.body) : []
  })
}

interface Listen {
  host: string | null
  port: number
  ssl: boolean
}

const WILDCARD_HOSTS = new Set(['*', '0.0.0.0', '::'])

function parseListen(args: string[]): Listen | null {
  const spec = args[0]
  if (!spec || spec.startsWith('unix:')) return null
  const ssl = args.slice(1).some((flag) => flag === 'ssl' || flag === 'quic')
  if (/^\d+$/.test(spec)) return { host: null, port: Number(spec), ssl }
  const match = /^(?:\[([^\]]*)\]|([^:\s]+))(?::(\d+))?$/.exec(spec)
  if (!match) return null
  const host = match[1] ?? match[2]
  return { host: WILDCARD_HOSTS.has(host) ? null : host, port: match[3] ? Number(match[3]) : 80, ssl }
}

const formatAddress = (host: string, port: number): string => `${host.includes(':') ? `[${host}]` : host}:${port}`

function probeAddress(listens: Listen[]): string {
  const onTlsPort = listens.filter((l) => l.port === 443)
  const pick = onTlsPort.find((l) => l.host) ?? onTlsPort[0] ?? listens.find((l) => l.ssl)
  return formatAddress(pick?.host ?? '127.0.0.1', pick?.port ?? 443)
}

function directives(server: Statement, name: string): Statement[] {
  return (server.body ?? []).filter((s) => s.name === name)
}

function serverBlock(file: string, server: Statement): ServerBlock {
  const listens = directives(server, 'listen').map((s) => parseListen(s.args)).filter((l): l is Listen => l !== null)
  const certPath = directives(server, 'ssl_certificate')[0]?.args[0] ?? ''
  const keyPath = directives(server, 'ssl_certificate_key')[0]?.args[0] ?? ''
  const names = [...new Set(directives(server, 'server_name').flatMap((s) => s.args).filter(Boolean))]
  return {
    id: `${file}:${server.line}`,
    file,
    line: server.line,
    names,
    tls: listens.some((l) => l.ssl) || (listens.some((l) => l.port === 443) && certPath !== ''),
    certPath,
    keyPath,
    probeAddress: probeAddress(listens),
    root: directives(server, 'root')[0]?.args[0] ?? null
  }
}

export function hasConfigFiles(dump: string): boolean {
  return splitConfigFiles(dump).length > 0
}

export function parseServerBlocks(dump: string): ServerBlock[] {
  return splitConfigFiles(dump).flatMap((file) =>
    findServers(parseStatements(file.content)).map((server) => serverBlock(file.path, server))
  )
}

export function parseCertbotCertificates(text: string): CertbotLineage[] {
  return text
    .split(/^\s*Certificate Name:/m)
    .slice(1)
    .map((chunk) => {
      const [name, ...rest] = chunk.split('\n')
      const field = (label: string) => new RegExp(`^\\s*${label}:\\s*(.*)$`, 'm').exec(rest.join('\n'))?.[1].trim() ?? ''
      return {
        name: name.trim(),
        domains: field('Domains').split(/\s+/).filter(Boolean),
        notAfter: parseCertbotExpiry(field('Expiry Date')),
        certPath: field('Certificate Path'),
        keyPath: field('Private Key Path')
      }
    })
    .filter((lineage) => lineage.name !== '')
}

function parseCertbotExpiry(value: string): number | null {
  const match = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})?/.exec(value)
  if (!match) return null
  const millis = Date.parse(`${match[1]}T${match[2]}${match[3] ?? 'Z'}`)
  return Number.isNaN(millis) ? null : Math.floor(millis / 1000)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseOpenSslDate(value: string | undefined): number | null {
  const match = /^([A-Za-z]{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})/.exec(value ?? '')
  if (!match) return null
  const month = MONTHS.indexOf(match[1])
  if (month < 0) return null
  return Math.floor(Date.UTC(Number(match[6]), month, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])) / 1000)
}

function labelled(text: string, label: string): string | undefined {
  return new RegExp(`^${label}\\s*=\\s*(.*)$`, 'm').exec(text)?.[1].trim()
}

const DN_FIELD = /(?:^|,\s*|\/)([A-Za-z][A-Za-z0-9.]*)\s*=\s*(.*?)(?=,\s*[A-Za-z][A-Za-z0-9.]*\s*=|\/[A-Za-z][A-Za-z0-9.]*=|$)/g

function dnFields(dn: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const match of dn.matchAll(DN_FIELD)) fields[match[1]] ??= match[2].trim()
  return fields
}

function certKind(subject: string, issuer: string): CertKind {
  if (/cloudflare/i.test(issuer) && /origin/i.test(issuer)) return 'cloudflare-origin'
  if (/let'?s encrypt/i.test(issuer)) return 'letsencrypt'
  if (subject === issuer) return 'self-signed'
  return 'other'
}

function subjectNames(text: string): string[] {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /Subject Alternative Name/i.test(line))
  if (start < 0) return []
  return [...(lines[start + 1] ?? '').matchAll(/DNS:([^,\s]+)/g)].map((m) => m[1])
}

export function noCertificate(error: string): OriginCert {
  return { kind: 'none', subject: '', issuer: '', names: [], notBefore: null, notAfter: null, error }
}

export function parseCertificate(text: string): OriginCert {
  const subject = labelled(text, 'subject')
  const issuer = labelled(text, 'issuer')
  if (!subject || !issuer) return noCertificate('The certificate could not be read')
  const subjectFields = dnFields(subject)
  const issuerFields = dnFields(issuer)
  const issuerParts = [issuerFields.O, issuerFields.OU, issuerFields.CN].filter(Boolean)
  return {
    kind: certKind(subject, issuer),
    subject: subjectFields.CN ?? subjectFields.O ?? subject,
    issuer: issuerParts.length > 0 ? issuerParts.join(' · ') : issuer,
    names: subjectNames(text),
    notBefore: parseOpenSslDate(labelled(text, 'notBefore')),
    notAfter: parseOpenSslDate(labelled(text, 'notAfter')),
    error: null
  }
}

export function parseProbes(output: string, targets: ProbeTarget[]): Record<string, OriginCert> {
  const results = new Map<number, OriginCert>()
  for (const section of splitSections(output)) {
    if (section.name !== 'PROBE') continue
    const [index, state] = section.arg.split(' ')
    const target = targets[Number(index)]
    if (target) results.set(Number(index), probeResult(state, section.body, target))
  }
  return Object.fromEntries(
    targets.map((target, index) => [target.name, results.get(index) ?? noCertificate('The server did not answer')])
  )
}

function probeResult(state: string, body: string, target: ProbeTarget): OriginCert {
  if (state === 'ok') return parseCertificate(body)
  if (state === 'timeout') return noCertificate(`Timed out connecting to ${target.address}`)
  return noCertificate(`No certificate presented on ${target.address}`)
}

function versionOf(text: string | undefined, pattern: RegExp): string | null {
  return pattern.exec(text ?? '')?.[1] ?? null
}

const TIMER_MECHANISMS: ReadonlySet<string> = new Set<RenewalMechanism>(['certbot.timer', 'snap.certbot.renew.timer'])

export function parseRenewal(body: string, journal: string): RenewalInfo {
  const values = parseKeyValues(body)
  if (TIMER_MECHANISMS.has(values.timer)) return timerRenewal(values, journal)
  return { mechanism: values.cron === '1' ? 'cron' : 'none', lastRun: null, lastResult: 'unknown', output: '' }
}

function timerRenewal(values: Record<string, string>, journal: string): RenewalInfo {
  const epoch = Number.parseInt(values.ExitEpoch ?? '', 10)
  const hasRun = values.ExecMainExitTimestamp !== undefined && values.ExecMainExitTimestamp !== ''
  return {
    mechanism: values.timer as RenewalMechanism,
    lastRun: Number.isFinite(epoch) ? epoch : null,
    lastResult: !hasRun ? 'unknown' : values.Result === 'success' ? 'success' : 'failed',
    output: journal.replace(/^-- No entries --$/m, '').trim()
  }
}

function otherWebServer(active: Record<string, string>): ServerFacts['otherWebServer'] {
  if (active.apache2 === 'active' || active.httpd === 'active') return 'apache'
  return active.caddy === 'active' ? 'caddy' : null
}

const LISTENER_KINDS: Record<string, ServingWebServer> = { nginx: 'nginx', apache2: 'apache', httpd: 'apache', caddy: 'caddy' }
const WEB_PORT = /:(80|443)$/

export function webListeners(ssOutput: string): { kind: ServingWebServer; port: number }[] {
  return ssOutput.split('\n').flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    const port = fields.find((field) => WEB_PORT.test(field))?.match(WEB_PORT)?.[1]
    const owner = /users:\(\("([^"]+)"/.exec(line)?.[1]
    const kind = owner === undefined ? undefined : LISTENER_KINDS[owner]
    return port && kind && fields[0] === 'LISTEN' ? [{ kind, port: Number(port) }] : []
  })
}

function listeningServer(ssOutput: string): ServingWebServer | null {
  const listeners = webListeners(ssOutput)
  const kinds = new Set(listeners.map((l) => l.kind))
  if (kinds.size <= 1) return listeners[0]?.kind ?? null
  const onTls = new Set(listeners.filter((l) => l.port === 443).map((l) => l.kind))
  if (onTls.size === 1) return [...onTls][0]
  return kinds.has('nginx') ? 'nginx' : [...kinds][0]
}

function activeServer(active: Record<string, string>): ServingWebServer | null {
  if (active.nginx === 'active') return 'nginx'
  if (active.apache2 === 'active' || active.httpd === 'active') return 'apache'
  return active.caddy === 'active' ? 'caddy' : null
}

function installedServer(paths: Record<string, string>): ServingWebServer | null {
  if (paths.nginx) return 'nginx'
  return paths.apache ? 'apache' : null
}

function apacheFacts(version: string | undefined, layout: string | undefined, path: string | undefined): ApacheFacts | null {
  if (!path) return null
  const kind = (layout ?? '').trim()
  return { version: versionOf(version, /Apache\/([\d.]+)/), layout: kind === 'debian' || kind === 'rhel' ? kind : null }
}

function addressesOf(hostnameOutput: string, sshServer: string | undefined): string[] {
  return [...new Set([...hostnameOutput.split(/\s+/), sshServer ?? ''].filter(Boolean))]
}

export function parseFacts(output: string): ParsedFacts {
  const sections = sectionBodies(output)
  const paths = parseKeyValues(sections.PATHS ?? '')
  const sudo = parseKeyValues(sections.SUDO ?? '')
  const active = parseKeyValues(sections.ACTIVE ?? '')
  return {
    nginx: versionOf(sections.NGINX_V, /nginx\/([\d.]+)/),
    apache: apacheFacts(sections.APACHE_V, sections.APACHE_LAYOUT, paths.apache),
    serving: listeningServer(sections.LISTEN ?? '') ?? activeServer(active) ?? installedServer(paths),
    openssl: versionOf(sections.OPENSSL_V, /^(?:OpenSSL|LibreSSL)\s+([\w.]+)/m),
    certbot: versionOf(sections.CERTBOT_V, /certbot\s+([\d.]+)/),
    otherWebServer: otherWebServer(active),
    renewal: parseRenewal(sections.RENEWAL ?? '', sections.JOURNAL ?? ''),
    sudo: { certbot: sudo.certbot === '1', nginx: sudo.nginx === '1', apache: sudo.apache === '1', full: sudo.full === '1' },
    paths: { certbot: paths.certbot || null, nginx: paths.nginx || null, apache: paths.apache || null },
    user: (sections.USER ?? '').trim(),
    addresses: addressesOf(sections.ADDRESSES ?? '', parseKeyValues(sections.SSH ?? '').server)
  }
}
