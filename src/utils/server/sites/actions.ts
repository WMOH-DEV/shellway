import type { ActionDefinition, ActionPlan, ActionStep, PlanBlockKind, ServerFacts } from '../../../types/server/core'
import { changedLines } from '../../ssl/originCa/diff'
import { webServerDriver } from '../../webServer'
import { fileEditStep } from '../fileEdit'
import { validCommand } from './commands'
import { INVENTORY_PROBE, inventoryFrom, vhostFor } from './inventory'
import type { SiteVhost, VhostServer } from './types'
import { asRecord, certificateRef, domainName, phpVersion, siteName, vhostPath, type CertificateRef } from './validate'
import { addDomain, phpVersionIn, removeDomain, vhostServer, withPhpVersion } from './vhost'

export interface DomainAddParams {
  vhost: string
  anchor: string
  domain: string
  certificate: CertificateRef | null
}

export interface DomainRemoveParams {
  vhost: string
  domain: string
  certificate: CertificateRef | null
}

export interface PhpVersionParams {
  vhost: string
  version: string
}

export interface SiteCommandParams {
  site: string
  command: string
}

const OWNER = /^[a-z_][a-z0-9_.-]{0,31}$/
const CERTBOT_TIMEOUT = 300
const COMMAND_TIMEOUT = 900

const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

function emptyPlan(title: string, summary: string): ActionPlan {
  return { title, area: 'sites', summary, steps: [], warnings: [], blocked: null, secrets: [] }
}

function blockedPlan(title: string, summary: string, message: string, kind: PlanBlockKind = 'precondition'): ActionPlan {
  return { ...emptyPlan(title, summary), blocked: { kind, message } }
}

const findVhost = (facts: ServerFacts, path: string): SiteVhost | undefined => vhostFor(inventoryFrom(facts), path)

function diffText(before: string, after: string): string {
  const sign = { same: ' ', add: '+', remove: '-' } as const
  return changedLines(before, after).map((line) => `${sign[line.kind]} ${line.text}`).join('\n')
}

function editStep(file: SiteVhost, content: string, server: VhostServer, label: string): ActionStep {
  const driver = webServerDriver(server.kind, server.layout)
  return fileEditStep({
    id: 'edit-site-file',
    label,
    path: file.realPath,
    content,
    originalSha256: file.sha256,
    test: driver.testCommand,
    reload: driver.reloadCommand,
    diff: diffText(file.content, content)
  })
}

function commandStep(id: string, label: string, script: string, root: boolean, timeoutSeconds: number): ActionStep {
  return { id, label, kind: 'command', root, script, display: script, timeoutSeconds }
}

function certificateStep(server: VhostServer, lineage: string, names: string[], expand: boolean): ActionStep {
  const domains = names.map((name) => `-d ${name}`).join(' ')
  const script = `certbot certonly --${server.kind} --non-interactive --cert-name ${lineage}${expand ? ' --expand' : ''} ${domains}`
  return commandStep('certificate', `Update the certificate ${lineage}`, script, true, CERTBOT_TIMEOUT)
}

function reloadStep(server: VhostServer): ActionStep {
  const driver = webServerDriver(server.kind, server.layout)
  return commandStep('reload', `Reload ${driver.label}`, `${driver.testCommand} && ${driver.reloadCommand}`, true, 60)
}

type EditResult = { file: SiteVhost; server: VhostServer; content: string } | { error: string }

function editFile(facts: ServerFacts, path: string, edit: (content: string, server: VhostServer) => string): EditResult {
  const file = findVhost(facts, path)
  const server = file ? vhostServer(file.realPath) : null
  if (!file || !server) return { error: 'Shellway could not read this site file. Check again.' }
  try {
    return { file, server, content: edit(file.content, server) }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

const unique = (names: string[]): string[] => [...new Set(names)]

export const domainAddAction: ActionDefinition<DomainAddParams> = {
  type: 'sites.domain-add',
  area: 'sites',
  needs: [INVENTORY_PROBE],
  validate(raw) {
    const r = asRecord(raw)
    return { vhost: vhostPath(r.vhost), anchor: domainName(r.anchor), domain: domainName(r.domain), certificate: certificateRef(r.certificate) }
  },
  plan({ vhost, anchor, domain, certificate }, facts) {
    const title = `Add ${domain}`
    const summary = `Adds ${domain} to the site that serves ${anchor}.`
    const edited = editFile(facts, vhost, (content, server) => addDomain(content, server, anchor, domain))
    if ('error' in edited) return blockedPlan(title, summary, edited.error)
    const plan = emptyPlan(title, summary)
    plan.steps.push(editStep(edited.file, edited.content, edited.server, `Add ${domain} to ${vhost}`))
    if (certificate) {
      plan.steps.push(certificateStep(edited.server, certificate.lineage, unique([...certificate.names, domain]), true), reloadStep(edited.server))
      plan.warnings.push(`The DNS record for ${domain} must point at this server before the certificate step, or that step fails.`)
    }
    return plan
  }
}

export const domainRemoveAction: ActionDefinition<DomainRemoveParams> = {
  type: 'sites.domain-remove',
  area: 'sites',
  needs: [INVENTORY_PROBE],
  validate(raw) {
    const r = asRecord(raw)
    return { vhost: vhostPath(r.vhost), domain: domainName(r.domain), certificate: certificateRef(r.certificate) }
  },
  plan({ vhost, domain, certificate }, facts) {
    const title = `Remove ${domain}`
    const summary = `Stops serving ${domain} from this site.`
    const edited = editFile(facts, vhost, (content, server) => removeDomain(content, server, domain))
    if ('error' in edited) return blockedPlan(title, summary, edited.error)
    const plan = emptyPlan(title, summary)
    plan.steps.push(editStep(edited.file, edited.content, edited.server, `Remove ${domain} from ${vhost}`))
    const remaining = certificate?.names.filter((name) => name !== domain) ?? []
    if (certificate && remaining.length > 0 && remaining.length < certificate.names.length) {
      plan.steps.push(certificateStep(edited.server, certificate.lineage, remaining, false), reloadStep(edited.server))
    }
    plan.warnings.push(`Shellway does not delete the DNS record for ${domain}. Remove it at your DNS provider if nothing else uses it.`)
    return plan
  }
}

export const phpVersionAction: ActionDefinition<PhpVersionParams> = {
  type: 'sites.php-version',
  area: 'sites',
  needs: [INVENTORY_PROBE],
  validate(raw) {
    const r = asRecord(raw)
    return { vhost: vhostPath(r.vhost), version: phpVersion(r.version) }
  },
  plan({ vhost, version }, facts) {
    const title = `Use PHP ${version}`
    const summary = `Points this site at the PHP ${version} FPM socket.`
    if (!inventoryFrom(facts)?.fpmVersions.includes(version)) {
      return blockedPlan(title, summary, `PHP ${version} FPM is not installed. Install it in Software first.`, 'unsupported')
    }
    const current = findVhost(facts, vhost)
    if (current && phpVersionIn(current.content) === version) return blockedPlan(title, summary, `This site already uses PHP ${version}.`)
    const edited = editFile(facts, vhost, (content) => withPhpVersion(content, version))
    if ('error' in edited) return blockedPlan(title, summary, edited.error)
    const plan = emptyPlan(title, summary)
    plan.steps.push(editStep(edited.file, edited.content, edited.server, `Switch ${vhost} to PHP ${version}`))
    return plan
  }
}

function ownerScript(owner: string, user: string, path: string, command: string): string {
  const inFolder = `cd -- ${quote(path)} && ${command}`
  if (owner === user) return inFolder
  return `sudo -n -u ${owner} -H sh -c ${quote(inFolder)}`
}

export const siteCommandAction: ActionDefinition<SiteCommandParams> = {
  type: 'sites.command',
  area: 'sites',
  needs: [INVENTORY_PROBE],
  validate(raw) {
    const r = asRecord(raw)
    return { site: siteName(r.site), command: validCommand(r.command) }
  },
  plan({ site, command }, facts) {
    const title = `Run a command on ${site}`
    const summary = command
    const inventory = inventoryFrom(facts)
    const ref = inventory?.sites.find((s) => s.name === site)
    if (!inventory || !ref) return blockedPlan(title, summary, 'Shellway could not find this site folder. Check again.')
    if (ref.owner !== inventory.user && !OWNER.test(ref.owner)) return blockedPlan(title, summary, `Shellway could not tell which user owns ${ref.path}, so it will not run the command. Give the folder a named owner, then check again.`)
    const plan = emptyPlan(title, summary)
    plan.steps.push(commandStep('command', command, ownerScript(ref.owner, inventory.user, ref.path, command), false, COMMAND_TIMEOUT))
    return plan
  }
}

export const SITES_ACTIONS = [domainAddAction, domainRemoveAction, phpVersionAction, siteCommandAction] as ActionDefinition[]
