import type { CreatedResources, RunRecord } from '../../../src/types/createSite'
import { removalSteps, type RemovalStep } from '../../../src/utils/createSite/removal'
import type { WebServerDriver } from '../../../src/utils/webServer/driver'
import { lastLine } from './CreateSiteRun'
import type { CreateSitePorts } from './ports'

const REMOVE_TIMEOUT_MS = 120_000

function withoutResource(created: CreatedResources, step: RemovalStep): CreatedResources {
  switch (step.kind) {
    case 'deploy-site': return { ...created, deploySite: null }
    case 'certificate': return { ...created, certificate: null }
    case 'dns-record': return { ...created, dnsRecords: created.dnsRecords.filter((record) => record.recordId !== step.recordId) }
    case 'folder': return { ...created, folder: null }
    case 'php-pool': return { ...created, phpPool: null }
    case 'site-file':
      if (created.httpsSiteFile?.path === step.path) return { ...created, httpsSiteFile: null }
      return created.siteFile?.path === step.path ? { ...created, siteFile: null } : created
  }
}

class RemoveRun {
  constructor(private record: RunRecord, private readonly ports: CreateSitePorts) {}

  async execute(steps: RemovalStep[]): Promise<RunRecord> {
    this.update({ phase: 'removing', error: null })
    for (const step of steps) {
      this.ports.output(`Removing ${step.title}\n`)
      try {
        await this.removeOne(step)
      } catch (err) {
        const message = `${step.title} was not removed: ${(err as Error).message}`
        this.ports.output(`${message}\n`)
        return this.update({ phase: 'remove-failed', error: message })
      }
      this.update({ created: withoutResource(this.record.created, step) })
    }
    return this.update({ phase: 'removed', current: null })
  }

  private async removeOne(step: RemovalStep): Promise<void> {
    switch (step.kind) {
      case 'deploy-site': return this.removeDeploySite(step.siteName)
      case 'dns-record': return this.removeDnsRecord(step.zoneId, step.recordId, step.name)
      case 'certificate':
      case 'site-file':
      case 'php-pool':
      case 'folder': return this.run(step.command, step.script)
    }
  }

  private async removeDeploySite(name: string): Promise<void> {
    try {
      await this.ports.deploy.remove(name)
    } catch (err) {
      if ((await this.ports.deploy.siteNames()).includes(name)) throw err
      this.ports.output(`Deploy site ${name} is already gone.\n`)
    }
  }

  private async removeDnsRecord(zoneId: string, recordId: string, name: string): Promise<void> {
    const dns = this.ports.dns
    if (dns === null) throw new Error('Cloudflare is not connected. Connect it in SSL settings, then try again.')
    try {
      await dns.remove(zoneId, recordId)
    } catch (err) {
      if ((await dns.find(zoneId, name)).some((record) => record.id === recordId)) throw err
      this.ports.output(`The DNS record for ${name} is already gone.\n`)
    }
  }

  private async run(command: string, script: string): Promise<void> {
    this.ports.output(`$ ${command}\n${script.trimEnd().split('\n').map((line) => `  ${line}`).join('\n')}\n`)
    const result = await this.ports.exec(command, { stdin: script, timeoutMs: REMOVE_TIMEOUT_MS, onOutput: this.ports.output })
    if (result.code !== 0) throw new Error(lastLine(result.stderr) || `exit code ${result.code}`)
  }

  private update(changes: Partial<RunRecord>): RunRecord {
    this.record = { ...this.record, ...changes }
    this.ports.save(this.record)
    return this.record
  }
}

export function removeCreated(record: RunRecord, ports: CreateSitePorts, driver: WebServerDriver): Promise<RunRecord> {
  return new RemoveRun(record, ports).execute(removalSteps(record, driver))
}
