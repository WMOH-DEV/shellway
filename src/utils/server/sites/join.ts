import type { SiteSummary } from '../../../types/deploy'
import type { HostnameStatus, ServerBlock, SslReport, Verdict } from '../../../types/ssl'
import { VERDICT_ORDER } from '../../ssl/verdict'
import type { SiteStack } from './types'
import type { CertificateRef } from './validate'

export interface SiteEntry {
  summary: SiteSummary
  blocks: ServerBlock[]
  hosts: HostnameStatus[]
  domain: string | null
}

export interface SitesJoin {
  sites: SiteEntry[]
  otherHosts: HostnameStatus[]
}

const trimSlashes = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path)

function isUnder(root: string, sitePath: string): boolean {
  const base = trimSlashes(sitePath)
  const dir = trimSlashes(root)
  return base !== '' && (dir === base || dir.startsWith(`${base}/`))
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const lower = (names: string[]) => names.map((name) => name.toLowerCase())

function siteBlocks(summary: SiteSummary, blocks: ServerBlock[]): ServerBlock[] {
  const health = hostOf(summary.config.healthUrl)
  const seeds = blocks.filter((b) => (b.root !== null && isUnder(b.root, summary.config.path)) || (health !== '' && lower(b.names).includes(health)))
  const names = new Set(seeds.flatMap((b) => lower(b.names)))
  return blocks.filter((b) => seeds.includes(b) || (b.file === seeds[0]?.file && lower(b.names).some((n) => names.has(n))))
}

function primaryDomain(summary: SiteSummary, hosts: HostnameStatus[]): string | null {
  const health = hostOf(summary.config.healthUrl)
  if (health && hosts.some((h) => h.name === health)) return health
  return hosts.find((h) => !h.name.startsWith('www.'))?.name ?? hosts[0]?.name ?? null
}

function siteEntry(summary: SiteSummary, report: SslReport | null): SiteEntry {
  if (!report) return { summary, blocks: [], hosts: [], domain: null }
  const blocks = siteBlocks(summary, report.blocks)
  const ids = new Set(blocks.map((b) => b.id))
  const names = new Set(blocks.flatMap((b) => lower(b.names)))
  const hosts = report.hostnames.filter((h) => ids.has(h.blockId) || names.has(h.name.toLowerCase()))
  const unique = hosts.filter((h, i) => hosts.findIndex((other) => other.name === h.name) === i)
  return { summary, blocks, hosts: unique, domain: primaryDomain(summary, unique) }
}

export function joinSites(summaries: SiteSummary[], report: SslReport | null): SitesJoin {
  const sites = summaries.map((summary) => siteEntry(summary, report))
  const claimed = new Set(sites.flatMap((s) => s.hosts.map((h) => h.name)))
  const otherHosts = (report?.hostnames ?? []).filter((h) => !claimed.has(h.name))
  return { sites, otherHosts }
}

const STACK_PATTERNS: [SiteStack, RegExp][] = [
  ['laravel', /\bartisan\b/],
  ['docker', /\bdocker(-compose|\s+compose)\b/],
  ['php', /\bcomposer\b/],
  ['node', /\b(npm|pnpm|yarn|pm2|node)\b/]
]

export function siteStack(summary: SiteSummary): SiteStack {
  const { buildSteps, activateSteps } = summary.config
  const commands = [...buildSteps, ...activateSteps].map((s) => s.command).join('\n')
  return STACK_PATTERNS.find(([, pattern]) => pattern.test(commands))?.[0] ?? 'static'
}

export const STACK_LABELS: Record<SiteStack, string> = {
  laravel: 'Laravel',
  php: 'PHP',
  node: 'Node.js',
  docker: 'Docker',
  static: 'Static'
}

export function worstHost(hosts: HostnameStatus[]): HostnameStatus | null {
  const rank = (verdict: Verdict) => VERDICT_ORDER.indexOf(verdict)
  return hosts.reduce<HostnameStatus | null>((worst, host) => (worst === null || rank(host.verdict) < rank(worst.verdict) ? host : worst), null)
}

export function plainBlock(entry: SiteEntry): ServerBlock | null {
  if (entry.blocks.some((b) => b.tls)) return null
  return entry.blocks[0] ?? null
}

export function siteFile(entry: SiteEntry): string | null {
  return (entry.blocks.find((b) => b.tls) ?? entry.blocks[0])?.file ?? null
}

export function siteCertificate(entry: SiteEntry, report: SslReport | null): CertificateRef | null {
  const lineageName = entry.hosts.find((h) => h.lineage !== null)?.lineage
  const lineage = report?.lineages.find((l) => l.name === lineageName)
  return lineage ? { lineage: lineage.name, names: lineage.domains } : null
}
