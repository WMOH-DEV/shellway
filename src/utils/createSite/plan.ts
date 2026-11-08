import type { CreateSiteInput, DnsInput, DnsRecordPlan, PlanAction, PlanActionId, PlanMeta, ServerTools, SiteServer } from '@/types/createSite'
import type { IssueRequest } from '@/types/ssl'
import { presetById } from '../deploy/presets'
import { deploySiteConfig } from './deploySite'
import { repoLabel } from '../deploy/siteDetail'
import { issueCommand, stagingCommand } from '../ssl/https/issueCommands'
import { pluralize } from '../ssl/time'
import type { WebServerDriver } from '../webServer/driver'
import { createDatabaseScript, databaseLabel } from './database'
import { envPathOf, managedEnv, maskedEnvLines } from './env'
import { createJobsScript, cronText, jobFiles, unitText } from './laravelJobs'
import { assertPoolOwner, createPoolScript, poolLayout, poolText } from './phpPool'
import { pm2ServiceName, pm2SetupScript } from './pm2'
import { installComposerScript, installPhpScript, phpNeed } from './php'
import { ROOT_SHELL, createSiteScript, enableModulesScript, folderScript, sitePaths } from './siteScripts'
import { TEMPLATES, siteFileText, usesPhp, type SiteTemplate } from './templates'
import { siteNames } from './templates/shared'
import { assertDomain, assertFolder, assertHealthPath, assertIpv4, assertOwner, assertPhpVersion, assertPort } from './validate'

type ActionFields = Pick<PlanAction, 'id' | 'title' | 'summary' | 'chip'> & Partial<PlanAction>

const action = (fields: ActionFields): PlanAction => ({ commands: [], script: null, config: null, records: [], note: '', ...fields })

const asRoot = (script: string): Pick<PlanAction, 'commands' | 'script'> => ({ commands: [ROOT_SHELL], script })

const MANUAL_DNS_NOTE = 'No Cloudflare zone for this domain. Create the record at your DNS provider, then press Check again.'

const TITLES: Record<Exclude<PlanActionId, 'site'>, string> = {
  php: 'PHP',
  composer: 'Composer',
  pm2: 'pm2',
  folder: 'Folder',
  pool: 'PHP pool',
  modules: 'Apache modules',
  database: 'Database',
  dns: 'DNS record',
  https: 'HTTPS',
  deploys: 'Deploys',
  env: 'Environment file',
  'first-deploy': 'First deploy and check',
  jobs: 'Scheduler and queue'
}

export const actionTitle = (id: PlanActionId, driver: WebServerDriver): string => (id === 'site' ? `${driver.label} site` : TITLES[id])

const MINUTES: Record<PlanActionId, number> = { php: 2, composer: 0.5, pm2: 0.5, folder: 0.25, pool: 0.25, modules: 0.25, site: 0.25, database: 0.25, dns: 0.5, https: 1, deploys: 0.25, env: 0.25, 'first-deploy': 3, jobs: 0.25 }

function phpAction(input: CreateSiteInput, template: SiteTemplate, tools: ServerTools): PlanAction[] {
  if (!usesPhp(template)) return []
  const version = assertPhpVersion(input.phpVersion)
  const need = phpNeed(tools.php, version, input.database?.engine ?? null)
  switch (need.kind) {
    case 'none':
      return []
    case 'unavailable':
      return [action({ id: 'php', title: TITLES.php, summary: `PHP ${version} is not installed`, chip: 'blocked', note: `This server's package sources do not offer PHP ${version}. Pick another version.` })]
    case 'install':
      return [action({
        id: 'php',
        title: TITLES.php,
        summary: `Install PHP ${version} with the extensions Laravel needs`,
        chip: 'installs',
        ...asRoot(installPhpScript(version, need.packages)),
        note: "Installed with apt from this server's own package sources. Shellway does not add any repository."
      })]
    case 'add':
      return [action({
        id: 'php',
        title: TITLES.php,
        summary: `Add ${need.packages.join(', ')} to PHP ${version}`,
        chip: 'installs',
        ...asRoot(installPhpScript(version, need.packages)),
        note: `Installed with apt. PHP ${version}-FPM reloads afterwards, which other sites using PHP ${version} share.`
      })]
  }
}

function composerAction(input: CreateSiteInput, template: SiteTemplate, tools: ServerTools): PlanAction[] {
  if (!template.needs.includes('composer') || tools.composer) return []
  return [action({
    id: 'composer',
    title: TITLES.composer,
    summary: 'Install composer from getcomposer.org into /usr/local/bin',
    chip: 'installs',
    ...asRoot(installComposerScript(input.phpVersion)),
    note: 'The installer runs only if it matches the checksum published at composer.github.io.'
  })]
}

function pm2Action(input: CreateSiteInput, template: SiteTemplate, tools: ServerTools): PlanAction[] {
  if (!template.needs.includes('pm2') || (tools.pm2 && tools.pm2Startup)) return []
  const service = pm2ServiceName(input.owner)
  return [action({
    id: 'pm2',
    title: TITLES.pm2,
    summary: tools.pm2 ? `Start ${service} on boot so the app comes back after a restart` : `Install pm2 with npm and start ${service} on boot`,
    chip: 'installs',
    ...asRoot(pm2SetupScript(input.owner, !tools.pm2)),
    note: `pm2 runs the app as ${input.owner}. Each deploy restarts it with npm start on port ${input.appPort}, so package.json needs a start script.`
  })]
}

function folderAction({ folder, owner }: CreateSiteInput): PlanAction {
  return action({
    id: 'folder',
    title: TITLES.folder,
    summary: `${assertFolder(folder)}-deploy owned by ${assertOwner(owner)}, and ${folder} pointing at its current release`,
    chip: 'new',
    ...asRoot(folderScript(folder, owner))
  })
}

function poolActions(input: CreateSiteInput, template: SiteTemplate): PlanAction[] {
  if (!usesPhp(template)) return []
  const { file, socket } = poolLayout(input)
  return [action({
    id: 'pool',
    title: TITLES.pool,
    summary: `PHP ${assertPhpVersion(input.phpVersion)}-FPM runs this site as ${assertPoolOwner(input.owner)} on its own socket`,
    chip: 'new',
    ...asRoot(createPoolScript(input)),
    config: poolText(input),
    note: `${file}, listening on ${socket}. The site can write its own storage and read its env file without opening them to other users. PHP-FPM must accept it before it reloads; otherwise the file is removed.`
  })]
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
      title: TITLES.modules,
      summary: `needs LoadModule ${missing.map((name) => `${name}_module`).join(', ')}`,
      chip: 'blocked',
      note: 'Shellway does not edit httpd.conf. Add the LoadModule lines by hand, then check again.'
    })]
  }
  const present = template.apacheModules.filter((name) => tools.apacheModules.includes(name))
  return [action({
    id: 'modules',
    title: TITLES.modules,
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
    title: actionTitle('site', driver),
    summary: `${input.siteName}.conf from the ${template.label} template${siteDetail(input, template)}`,
    chip: 'new',
    ...asRoot(createSiteScript({ driver, server: input.server, siteName: input.siteName, text: config })),
    config,
    note: siteNote(input.server, file, driver)
  })
}

function databaseActions(input: CreateSiteInput): PlanAction[] {
  const { database } = input
  if (database === null) return []
  const note = database.engine === 'sqlite'
    ? 'Kept in the shared folder, outside the releases, so it survives every deploy. Only the site user can read it.'
    : `Refuses if the name is taken. The password is generated for this site and written only to its env file. Run as root with the ${database.engine === 'mysql' ? 'mysql' : 'psql'} client.`
  return [action({ id: 'database', title: TITLES.database, summary: databaseLabel(database), chip: 'new', ...asRoot(createDatabaseScript(database, input.owner, null)), note })]
}

export function dnsRecords(input: Pick<CreateSiteInput, 'domain' | 'includeWww'>, serverIp: string, proxied: boolean): DnsRecordPlan[] {
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
  return action({ id: 'dns', title: TITLES.dns, summary, chip: 'needs you', records, note: MANUAL_DNS_NOTE })
}

function dnsAction(input: CreateSiteInput): PlanAction {
  const { dns } = input
  if (dns === null || dns.zoneId === null || dns.zoneName === null) return manualDnsAction(input, dns)
  const zone = assertInZone(input.domain, dns.zoneName)
  const records = dnsRecords(input, dns.serverIp, dns.proxied)
  return action({
    id: 'dns',
    title: TITLES.dns,
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
    title: TITLES.https,
    summary: parts.join(' · '),
    chip: 'ready',
    commands: [...(staging ? [stagingCommand(request, driver.kind)] : []), issueCommand(request, driver.kind)]
  })
}

function deploysAction(input: CreateSiteInput, template: SiteTemplate): PlanAction {
  const preset = presetById(template.preset)
  const { buildSteps, activateSteps } = deploySiteConfig(input)
  const commandCount = buildSteps.length + activateSteps.length
  const isAuto = input.sourceMode === 'auto'
  const source = isAuto ? `Auto on server every ${input.pollMinutes} min` : 'From my PC'
  return action({
    id: 'deploys',
    title: TITLES.deploys,
    summary: `${repoLabel(input.repoUrl)} · ${input.branch} · ${source} · ${preset.label} preset, ${pluralize(commandCount, 'command')}`,
    chip: isAuto ? 'needs you' : 'ready',
    note: isAuto ? 'The server needs a deploy key with read access to the repository.' : ''
  })
}

function envActions(input: CreateSiteInput): PlanAction[] {
  if (!input.env) return []
  const managed = managedEnv(input, null)
  return [action({
    id: 'env',
    title: TITLES.env,
    summary: `${envPathOf(input.folder)}${managed.length > 0 ? ` · ${pluralize(managed.length, 'value')} set by Shellway` : ''}`,
    chip: 'new',
    config: maskedEnvLines(managed),
    note: 'Your own settings from the environment section are written too. Secrets are hidden here. Only the site user can read the file, and every deploy uses it.'
  })]
}

function firstDeployAction(input: CreateSiteInput): PlanAction {
  return action({
    id: 'first-deploy',
    title: TITLES['first-deploy'],
    summary: `Deploy ${input.branch}, then https://${assertDomain(input.domain)}${assertHealthPath(input.healthPath)} must return 200`,
    chip: 'ready'
  })
}

function missingJobTools(input: CreateSiteInput, tools: ServerTools): string[] {
  return [...(input.jobs.scheduler && !tools.cron ? ['cron'] : []), ...(input.jobs.queueWorker && !tools.systemd ? ['systemd'] : [])]
}

function jobsSummary({ jobs, siteName }: CreateSiteInput): string {
  const { cronFile, unitFile } = jobFiles(siteName, jobs)
  return [...(cronFile ? ['schedule:run every minute'] : []), ...(unitFile ? ['queue:work kept running by systemd'] : [])].join(' · ')
}

const restartsQueue = ({ activateSteps }: CreateSiteInput): boolean => activateSteps.some(({ command }) => command.includes('queue:restart'))

function jobsNote(input: CreateSiteInput, hasWorker: boolean): string {
  const base = `Runs as ${input.owner} in ${input.folder}, so it always uses the current release.`
  if (!hasWorker) return base
  return restartsQueue(input)
    ? `${base} Each deploy runs queue:restart, and systemd starts the worker again on the new code.`
    : `${base} Your deploy commands do not run queue:restart, so the worker keeps the old code until it restarts.`
}

function jobsActions(input: CreateSiteInput, template: SiteTemplate, tools: ServerTools): PlanAction[] {
  if (template.id !== 'laravel' || (!input.jobs.scheduler && !input.jobs.queueWorker)) return []
  const missing = missingJobTools(input, tools)
  if (missing.length > 0) {
    return [action({ id: 'jobs', title: TITLES.jobs, summary: `needs ${missing.join(' and ')}`, chip: 'blocked', note: `This server has no ${missing.join(' or ')}. Turn the option off in the commands step.` })]
  }
  const { cronFile, unitFile } = jobFiles(input.siteName, input.jobs)
  return [action({
    id: 'jobs',
    title: TITLES.jobs,
    summary: jobsSummary(input),
    chip: 'new',
    ...asRoot(createJobsScript(input, input.jobs)),
    config: [...(cronFile ? [`# ${cronFile}`, cronText(input)] : []), ...(unitFile ? [`# ${unitFile}`, unitText(input)] : [])].join('\n'),
    note: jobsNote(input, unitFile !== null)
  })]
}

export function buildPlan(input: CreateSiteInput, tools: ServerTools, driver: WebServerDriver): PlanAction[] {
  const template = TEMPLATES[input.template]
  return [
    ...phpAction(input, template, tools),
    ...composerAction(input, template, tools),
    ...pm2Action(input, template, tools),
    folderAction(input),
    ...poolActions(input, template),
    ...modulesActions(input, template, tools),
    siteAction(input, template, driver),
    ...databaseActions(input),
    dnsAction(input),
    httpsAction(input, driver),
    deploysAction(input, template),
    ...envActions(input),
    firstDeployAction(input),
    ...jobsActions(input, template, tools)
  ]
}

export function planMeta(actions: PlanAction[]): PlanMeta {
  const minutes = actions.reduce((total, { id }) => total + MINUTES[id], 0)
  return {
    minutes: Math.ceil(minutes),
    needsFullSudo: actions.some(({ commands }) => commands.some((command) => command.startsWith('sudo -n')))
  }
}
