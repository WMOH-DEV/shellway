import type { CreateSiteInput, DnsInput, DnsRecordPlan, PlanAction, PlanActionId, PlanMeta, ServerTools, SiteServer } from '@/types/createSite'
import type { IssueRequest } from '@/types/ssl'
import { presetById } from '../deploy/presets'
import { repoLabel } from '../deploy/siteDetail'
import { issueCommand, stagingCommand } from '../ssl/https/issueCommands'
import { pluralize } from '../ssl/time'
import type { WebServerDriver } from '../webServer/driver'
import { ROOT_SHELL, createSiteScript, enableModulesScript, folderScript, sitePaths } from './siteScripts'
import { TEMPLATES, siteFileText, usesPhp, type SiteTemplate } from './templates'
import { siteNames } from './templates/shared'
import { assertDomain, assertFolder, assertHealthPath, assertIpv4, assertOwner, assertPhpVersion, assertPort } from './validate'

type ActionFields = Pick<PlanAction, 'id' | 'title' | 'summary' | 'chip'> & Partial<PlanAction>

const action = (fields: ActionFields): PlanAction => ({ commands: [], script: null, config: null, records: [], note: '', ...fields })

const asRoot = (script: string): Pick<PlanAction, 'commands' | 'script'> => ({ commands: [ROOT_SHELL], script })

const MANUAL_DNS_NOTE = 'No Cloudflare zone for this domain. Create the record at your DNS provider, then press Check again.'

const MINUTES: Record<PlanActionId, number> = { folder: 0.25, modules: 0.25, site: 0.25, dns: 0.5, https: 1, deploys: 0.25, 'first-deploy': 3 }

function folderAction({ folder, owner }: CreateSiteInput): PlanAction {
  return action({
    id: 'folder',
    title: 'Folder',
    summary: `${assertFolder(folder)} with releases/ and shared/, owned by ${assertOwner(owner)}`,
    chip: 'new',
    ...asRoot(folderScript(folder, owner))
  })
}

const apacheConfs = (input: CreateSiteInput, template: SiteTemplate): string[] =>
  usesPhp(template) ? [`php${assertPhpVersion(input.phpVersion)}-fpm`] : []

function modulesActions(input: CreateSiteInput, template: SiteTemplate, tools: ServerTools): PlanAction[] {
  if (input.server.kind !== 'apache') return []
  const missing = template.apacheModules.filter((name) => !tools.apacheModules.includes(name))
  if (missing.length === 0) return []
  const script = enableModulesScript(input.server, missing, apacheConfs(input, template))
  if (script === null) {
    return [action({
      id: 'modules',
      title: 'Apache modules',
      summary: `needs LoadModule ${missing.map((name) => `${name}_module`).join(', ')}`,
      chip: 'blocked',
      note: 'Shellway does not edit httpd.conf. Add the LoadModule lines by hand, then check again.'
    })]
  }
  const present = template.apacheModules.filter((name) => tools.apacheModules.includes(name))
  return [action({
    id: 'modules',
    title: 'Apache modules',
    summary: `${missing.join(', ')} to enable${present.length > 0 ? ` · ${present.join(', ')} already on` : ''}`,
    chip: `${missing.length} to enable`,
    ...asRoot(script),
    note: 'Checked with apache2ctl -M. Only missing modules are enabled, nothing is disabled. Applied together with the site below.'
  })]
}

function siteDetail(input: CreateSiteInput, template: SiteTemplate): string {
  if (usesPhp(template)) return ` · PHP ${assertPhpVersion(input.phpVersion)}-fpm${input.server.kind === 'apache' ? ' via proxy_fcgi' : ''}`
  if (template.proxiesToApp) return ` · proxy to 127.0.0.1:${assertPort(input.appPort)}`
  return ''
}

function siteNote(server: SiteServer, file: string, driver: WebServerDriver): string {
  const test = `${driver.testCommand} must pass before reload`
  if (server.kind === 'nginx') return `${file}, linked into sites-enabled. ${test}; otherwise the file is removed.`
  if (server.layout === 'debian') return `${file}, enabled with a2ensite. ${test}; otherwise the site is disabled and removed.`
  return `${file}, active because it is in conf.d. ${test}; otherwise the file is removed.`
}

function siteAction(input: CreateSiteInput, template: SiteTemplate, driver: WebServerDriver): PlanAction {
  const { file } = sitePaths(input.server, input.siteName)
  const config = siteFileText(input)
  return action({
    id: 'site',
    title: `${driver.label} site`,
    summary: `${input.siteName}.conf from the ${template.label} template${siteDetail(input, template)}`,
    chip: 'new',
    ...asRoot(createSiteScript({ driver, server: input.server, siteName: input.siteName, text: config })),
    config,
    note: siteNote(input.server, file, driver)
  })
}

function dnsRecords(input: CreateSiteInput, serverIp: string, proxied: boolean): DnsRecordPlan[] {
  const [domain, www] = siteNames(input)
  const records: DnsRecordPlan[] = [{ type: 'A', name: domain, content: assertIpv4(serverIp), proxied }]
  return www === undefined ? records : [...records, { type: 'CNAME', name: www, content: domain, proxied }]
}

function relativeName(name: string, zone: string): string {
  if (name === zone) return '@'
  return name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name
}

function recordSummary(record: DnsRecordPlan, zone: string | null): string {
  const shown = (name: string): string => (zone === null ? name : relativeName(name, zone))
  const target = record.type === 'A' ? record.content : shown(record.content)
  return `${record.type} ${shown(record.name)} → ${target}`
}

function proxyLabel(records: DnsRecordPlan[], proxied: boolean): string {
  if (!proxied) return 'DNS only'
  return records.length > 1 ? 'both proxied' : 'proxied'
}

function assertInZone(domain: string, zone: string): string {
  if (domain !== zone && !domain.endsWith(`.${assertDomain(zone)}`)) throw new Error(`${domain} is not in the zone ${zone}`)
  return zone
}

function manualDnsAction(input: CreateSiteInput, dns: DnsInput | null): PlanAction {
  const records = dns === null ? [] : dnsRecords(input, dns.serverIp, false)
  const summary = records.length === 0
    ? `Point ${siteNames(input).join(' and ')} at this server by hand`
    : `${records.map((record) => recordSummary(record, null)).join(' · ')} · create by hand`
  return action({ id: 'dns', title: 'DNS record', summary, chip: 'needs you', records, note: MANUAL_DNS_NOTE })
}

function dnsAction(input: CreateSiteInput): PlanAction {
  const { dns } = input
  if (dns === null || dns.zoneId === null || dns.zoneName === null) return manualDnsAction(input, dns)
  const zone = assertInZone(input.domain, dns.zoneName)
  const records = dnsRecords(input, dns.serverIp, dns.proxied)
  return action({
    id: 'dns',
    title: 'DNS record',
    summary: `${records.map((record) => recordSummary(record, zone)).join(' · ')} · ${proxyLabel(records, dns.proxied)}`,
    chip: 'new',
    records,
    note: `Created in Cloudflare zone ${zone} with your token. Nothing else in the zone changes.`
  })
}

function httpsAction(input: CreateSiteInput, driver: WebServerDriver): PlanAction {
  const { email, redirect, staging } = input.https
  const request: IssueRequest = { blockId: '', names: siteNames(input), email, redirect, staging }
  const parts = ["Let's Encrypt via certbot", ...(staging ? ['staging test first'] : []), redirect ? 'HTTP → HTTPS redirect' : 'no HTTP → HTTPS redirect']
  return action({
    id: 'https',
    title: 'HTTPS',
    summary: parts.join(' · '),
    chip: 'ready',
    commands: [...(staging ? [stagingCommand(request, driver.kind)] : []), issueCommand(request, driver.kind)]
  })
}

function deploysAction(input: CreateSiteInput, template: SiteTemplate): PlanAction {
  const preset = presetById(template.preset)
  const commandCount = preset.buildSteps({ buildScript: false }).length + preset.activateSteps.length
  const isAuto = input.sourceMode === 'auto'
  const source = isAuto ? `Auto on server every ${input.pollMinutes} min` : 'From my PC'
  return action({
    id: 'deploys',
    title: 'Deploys',
    summary: `${repoLabel(input.repoUrl)} · ${input.branch} · ${source} · ${preset.label} preset, ${pluralize(commandCount, 'command')}`,
    chip: isAuto ? 'needs you' : 'ready',
    note: isAuto ? 'The server needs a deploy key with read access to the repository.' : ''
  })
}

function firstDeployAction(input: CreateSiteInput): PlanAction {
  return action({
    id: 'first-deploy',
    title: 'First deploy and check',
    summary: `Deploy ${input.branch}, then https://${assertDomain(input.domain)}${assertHealthPath(input.healthPath)} must return 200`,
    chip: 'ready'
  })
}

export function buildPlan(input: CreateSiteInput, tools: ServerTools, driver: WebServerDriver): PlanAction[] {
  const template = TEMPLATES[input.template]
  return [
    folderAction(input),
    ...modulesActions(input, template, tools),
    siteAction(input, template, driver),
    dnsAction(input),
    httpsAction(input, driver),
    deploysAction(input, template),
    firstDeployAction(input)
  ]
}

export function planMeta(actions: PlanAction[]): PlanMeta {
  const minutes = actions.reduce((total, { id }) => total + MINUTES[id], 0)
  return {
    minutes: Math.ceil(minutes),
    needsFullSudo: actions.some(({ commands }) => commands.some((command) => command.startsWith('sudo -n')))
  }
}
